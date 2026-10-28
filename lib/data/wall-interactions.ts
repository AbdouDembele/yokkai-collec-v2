import { createClient } from "@/utils/supabase/client";
import type { FriendFeedCursor, FriendFeedPost } from "./friend-feed";
import { liveWall } from "./profile-wall";

export type WallReply = {
  id: string;
  text: string;
  createdAt: string;
  isMe: boolean;
  canDelete?: boolean;
  author: FriendFeedPost["author"];
  hasMedia?: boolean;
  mediaPath?: string | null;
  gifUrl?: string | null;
  previewUrl?: string;
};
export type WallActivity = {
  publicReplyNotice?: boolean;
  reactions?: { emoji: string; count: number; reactedByMe: boolean }[];
  likes: number;
  likedByMe: boolean;
  replyCount: number;
  items: WallReply[];
  next: FriendFeedCursor | null;
  deletedMediaPath?: string | null;
};
export type WallInteractions = {
  react: (post: string, emoji: string, reacted: boolean) => Promise<WallActivity>;
  read: (post: string, cursor?: FriendFeedCursor | null) => Promise<WallActivity>;
  like: (post: string, liked: boolean) => Promise<WallActivity>;
  reply: (post: string, id: string, text: string, attachment?: {mediaPath: string | null; gifUrl: string | null}) => Promise<WallActivity>;
  remove: (post: string, id: string) => Promise<WallActivity>;
  upload?: (file: File) => Promise<string>;
  discard?: (path: string) => Promise<void>;
};
async function rpc(name: string, args: Record<string, unknown>): Promise<WallActivity> {
  const { data, error } = await createClient().rpc(name, args).abortSignal(AbortSignal.timeout(12000));
  if (error) {
    if (error.message === "WALL_POST_UNAVAILABLE") throw Object.assign(new Error("Couldn't load or update this post. Access may have changed. Please try again."), {code: "WALL_POST_UNAVAILABLE"});
    if (error.message === "WALL_GIF_INVALID" || error.message === "GIF_RATING_REJECTED") throw new Error("Choose a GIF from the picker.");
    if (error.message === "WALL_MEDIA_INVALID") throw new Error("The image is no longer available. Choose it again.");
    if (error.message === "WALL_REPLY_INVALID") throw new Error("Write up to 1,000 characters, or add an image or GIF.");
    if (error.message === "WALL_REACTION_LIMIT") throw new Error("You can add up to 8 different reactions to a post. Remove one to add another.");
    if (error.message === "WALL_REPLY_RATE_LIMITED") throw new Error("Please wait a few seconds between replies (up to 30 per hour).");
    if (error.message === "WALL_REPLIES_FULL") throw new Error("This post has reached its reply limit.");
    throw new Error("Couldn't load or update this post. Access may have changed. Please try again.");
  }
  return data as WallActivity;
}
export const liveWallInteractions: WallInteractions = {
  react: (post, emoji, reacted) => rpc("set_wall_post_reaction", { p_post_id: post, p_emoji: emoji, p_reacted: reacted }),
  read: (post, cursor) => rpc("get_wall_post_activity", { p_post_id: post, p_before: cursor?.at ?? null, p_before_id: cursor?.id ?? null }),
  like: (post, liked) => rpc("set_wall_post_like", { p_post_id: post, p_liked: liked }),
  reply: (post, id, text, attachment) => attachment?.mediaPath || attachment?.gifUrl
    ? rpc("publish_wall_post_reply_media", {p_post_id:post,p_id:id,p_body:text,p_media_path:attachment.mediaPath,p_gif_url:attachment.gifUrl})
    : rpc("publish_wall_post_reply", { p_post_id: post, p_id: id, p_body: text }),
  upload: async file => {
    const {data,error}=await createClient().auth.getUser();
    if(error || !data.user) throw new Error("Sign in to add an image.");
    return liveWall.upload(file,data.user.id);
  },
  discard: async path => {
    const {data,error}=await createClient().auth.getUser();
    if(error || !data.user) throw new Error("Sign in to finish file cleanup.");
    if(path.startsWith(`${data.user.id}/`)) return liveWall.discard(path);
    const {discardModeratedReplyMedia}=await import("@/app/social/actions");
    if(!(await discardModeratedReplyMedia(path)).ok) throw new Error("Couldn't finish file cleanup. Please try again.");
  },
  remove: (post, id) => rpc("delete_wall_post_reply", { p_post_id: post, p_reply_id: id })
};

export async function getWallPostsActivity(ids: string[]): Promise<Record<string, WallActivity>> {
  if (ids.length > 20) throw new Error("Load activity for up to 20 posts at a time.");
  if (!ids.length) return {};
  const { data, error } = await createClient().rpc("get_wall_posts_activity", {p_post_ids: ids})
    .abortSignal(AbortSignal.timeout(12000));
  if (error?.code === "PGRST202" || error?.code === "42883") {
    const entries = await Promise.all(ids.map(async id => {
      const result = await createClient().rpc("get_wall_post_activity", {p_post_id:id,p_before:null,p_before_id:null})
        .abortSignal(AbortSignal.timeout(12000));
      if (result.error?.message === "WALL_POST_UNAVAILABLE") return [];
      if (result.error) throw new Error("Couldn't load this page's activity. Please try again.");
      return [[id, result.data as WallActivity]];
    }));
    return Object.fromEntries(entries.flat());
  }
  if (error) throw new Error("Couldn't load this page's activity. Please try again.");
  return data as Record<string, WallActivity>;
}

export async function hydrateFeedActivity(posts: FriendFeedPost[]): Promise<FriendFeedPost[]> {
  const activity = await getWallPostsActivity(posts.map(post => post.id));
  return posts.map(post => ({...post, activity: activity[post.id] ?? null}));
}
