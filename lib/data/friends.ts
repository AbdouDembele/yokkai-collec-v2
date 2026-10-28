import type { PlayerCosmetics } from "@/components/styled-player-name";
import type { PageCursor, RpcPage } from "@/lib/data/demand-pages";
import { createClient } from "@/utils/supabase/client";
import { readRpcPages } from "@/lib/data/rpc-pages.mjs";

export type FriendshipStatus = "none"|"incoming"|"outgoing"|"accepted"|"self";
export type FriendUser = {profileStyle?:PlayerCosmetics;id:string;pseudo:string;avatarUrl?:string|null;status?:FriendshipStatus;requestId?:string;createdAt?:string;isOnline?:boolean;lastSeenAt?:string|null};
export type Friendships = {friends:FriendUser[];incoming:FriendUser[];outgoing:FriendUser[]};
export type PublicProfile = {id:string;pseudo:string;friendshipStatus:FriendshipStatus};
let client:ReturnType<typeof createClient>|undefined;
const db=()=>client??=createClient();

type SupabaseFailure={message?:string;code?:string;details?:string;hint?:string;status?:number;statusCode?:number|string};
class FriendsError extends Error { constructor(message:string,readonly reason?:string){super(message);this.name="FriendsError";} }

const businessMessages:Record<string,string>={
  ACTION_UNAVAILABLE:"Couldn't send this request.",
  CANNOT_FRIEND_SELF:"You can't add yourself as a friend.",
  PROFILE_NOT_FOUND:"This profile couldn't be found.",
  FRIEND_REQUEST_NOT_FOUND:"This request is no longer available.",
  FRIENDSHIP_NOT_FOUND:"This friendship is no longer available.",
  FRIENDSHIP_EXISTS:"You're already friends or have a pending request with this player.",
  FRIEND_REQUEST_LIMIT:"You've sent too many friend requests. Try again later.",
  FRIEND_REQUEST_COOLDOWN:"You can send a new request to this player later.",
};

function details(error:unknown):SupabaseFailure{
  if(error&&typeof error==="object")return error as SupabaseFailure;
  return {message:typeof error==="string"?error:"Unknown error"};
}

function logFailure(rpc:string,error:unknown){
  if(process.env.NODE_ENV==="production")return;
  const failure=details(error);
  console.error(`[friends] RPC ${rpc} failed`,{code:failure.code,status:failure.status??failure.statusCode,message:failure.message,details:failure.details,hint:failure.hint});
}

function friendlyFailure(error:unknown){
  const failure=details(error);const status=Number(failure.status??failure.statusCode);const message=failure.message??"";
  if(message in businessMessages)return new FriendsError(businessMessages[message],message);
  if(status===401||status===403||failure.code==="PGRST301"||failure.code==="42501"||/unauthori[sz]ed|forbidden|permission denied|row-level security/i.test(message))
    return new FriendsError("You don't have permission to do this. Sign in again and retry.","AUTHORIZATION");
  if(error instanceof TypeError||/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message))
    return new FriendsError("Couldn't reach the server. Check your connection and try again.","NETWORK");
  return new FriendsError("Friends are temporarily unavailable. Please try again in a moment.",failure.code);
}

async function call<T>(name:string,args?:Record<string,unknown>,paged:boolean|{cursor:PageCursor}=false):Promise<T>{
  let result:{data:unknown;error:SupabaseFailure|null;nextCursor?:PageCursor};
  try{result=paged?await readRpcPages(db().rpc.bind(db()),name,typeof paged === "object" ? {...paged,maxPages:1} : undefined):await db().rpc(name,args);}catch(error){logFailure(name,error);throw friendlyFailure(error);}
  if(result.error){logFailure(name,result.error);throw friendlyFailure(result.error);}
  return (typeof paged === "object" ? {items:result.data,nextCursor:result.nextCursor??null} : result.data) as T;
}
export const searchUsers=(query:string)=>call<FriendUser[]>("search_users",{p_query:query});
export const getFriendships=async():Promise<Friendships>=>{
  const data=await call<Friendships|{bucket:keyof Friendships;friend:FriendUser}[]>("get_friendships",undefined,true);
  if(!Array.isArray(data))return data; // Legacy database before the grouped migration.
  const lists:Friendships={friends:[],incoming:[],outgoing:[]};
  for(const item of data)lists[item.bucket].push(item.friend);
  return lists;
};
export async function touchPresence(){
  const {data}=await db().auth.getSession();
  if(!data.session?.user)return false;
  await call<string|null>("touch_presence");
  return true;
}
export const getPublicProfile=(id:string)=>call<PublicProfile>("get_public_profile",{p_user_id:id});
export async function sendFriendRequest(id:string,lookupExisting=true){
  try{return await call<string>("send_friend_request",{p_friend_id:id});}
  catch(error){
    if(!lookupExisting||!(error instanceof FriendsError)||error.reason!=="FRIENDSHIP_EXISTS")throw error;
    try{
      const current=await getFriendships();
      if(current.friends.some(friend=>friend.id===id))throw new FriendsError("You're already friends with this player.","ALREADY_FRIENDS");
      if(current.outgoing.some(friend=>friend.id===id))throw new FriendsError("You've already sent this player a friend request.","REQUEST_ALREADY_SENT");
      if(current.incoming.some(friend=>friend.id===id))throw new FriendsError("This player has already sent you a friend request.","REQUEST_ALREADY_RECEIVED");
    }catch(lookupError){if(lookupError instanceof FriendsError&&lookupError.reason!=="FRIENDSHIP_EXISTS")throw lookupError;}
    throw error;
  }
}
export const respondFriendRequest=(id:string,accept:boolean)=>call<boolean>("respond_friend_request",{p_request_id:id,p_accept:accept});
export const removeFriend=(id:string)=>call<boolean>("remove_friend",{p_friend_id:id});
export const cancelFriendRequest=(id:string)=>call<boolean>("cancel_friend_request",{p_friend_id:id});

export type FriendshipItem = {bucket:keyof Friendships;friend:FriendUser};
export function groupFriendships(items:FriendshipItem[]):Friendships {
  const lists:Friendships={friends:[],incoming:[],outgoing:[]};
  for(const item of items) lists[item.bucket].push(item.friend);
  return lists;
}
export async function getFriendshipsPage(cursor:PageCursor=null):Promise<RpcPage<FriendshipItem>> {
  const page=await call<RpcPage<FriendshipItem>|{items:Friendships;nextCursor:PageCursor}>("get_friendships",undefined,{cursor});
  return {...page,items:Array.isArray(page.items)?page.items:Object.entries(page.items).flatMap(([bucket,friends])=>friends.map(friend=>({bucket:bucket as keyof Friendships,friend})))};
}

export function friendshipItems(lists:Friendships):FriendshipItem[] {
  return (Object.keys(lists) as (keyof Friendships)[]).flatMap(bucket=>lists[bucket].map(friend=>({bucket,friend})));
}
