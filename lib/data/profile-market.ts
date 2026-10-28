import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import { withLiveCardFranchises } from "@/lib/data/cards";
import { getAuction, placeBid, cancelAuction, toggleWatch, type AuctionData, type AuctionDetail } from "@/lib/data/market";
import type { AuctionChatAdapter } from "@/components/community-views";

export type ProfileAuctionCursor = {createdAt:string;id:string};
export type ProfileAuctionPage = {items:AuctionData[];nextCursor:ProfileAuctionCursor|null};
export type ProfileMarketAdapter = {
  list: typeof getProfileActiveAuctions;
  viewer: () => Promise<string>;
  get: (id:string)=>Promise<AuctionDetail>;
  bid: typeof placeBid;
  cancel: typeof cancelAuction;
  watch: typeof toggleWatch;
  chat?: AuctionChatAdapter;
};
export async function getProfileActiveAuctions(ownerId:string,cursor:ProfileAuctionCursor|null=null):Promise<ProfileAuctionPage> {
  const client=createClient();
  const {data,error}=await readRequest(signal=>client.rpc("get_profile_active_auctions",{p_owner_id:ownerId,p_cursor:cursor,p_limit:20}).abortSignal(signal));
  if(error) throw new Error("Active listings are temporarily unavailable.");
  const page=data as ProfileAuctionPage;
  const cards=await withLiveCardFranchises(page.items.map(item=>item.card),true);
  return {...page,items:page.items.map((item,index)=>({...item,card:cards[index]}))};
}
export const liveProfileMarket:ProfileMarketAdapter={
  list:getProfileActiveAuctions,
  viewer:async()=>{
    const {data,error}=await createClient().auth.getUser();
    if(error||!data.user) throw new Error("Sign in again to view this auction.");
    return data.user.id;
  },
  get:getAuction,bid:placeBid,cancel:cancelAuction,watch:toggleWatch
};
