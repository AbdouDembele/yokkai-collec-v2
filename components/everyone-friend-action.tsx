"use client";

import { FriendAction, type FriendActionAdapter } from "@/components/friends";
import {
  cancelFriendRequest,
  respondFriendRequest,
  sendFriendRequest,
  type FriendshipStatus
} from "@/lib/data/friends";
import type { FeedRelationship, FriendFeedPost } from "@/lib/data/friend-feed";
import { invalidateSocialUnread } from "@/lib/data/social-unread";

const adapter: FriendActionAdapter = {
  send: id => sendFriendRequest(id, false),
  respond: respondFriendRequest
};
const status: Record<FeedRelationship, FriendshipStatus> = {
  self: "self",
  friends: "accepted",
  outgoing_pending: "outgoing",
  incoming_pending: "incoming",
  none: "none"
};
const relationship: Record<FriendshipStatus, FeedRelationship> = {
  self: "self",
  accepted: "friends",
  outgoing: "outgoing_pending",
  incoming: "incoming_pending",
  none: "none"
};

export function EveryoneFriendAction({
  post,
  onChanged
}: {
  post: FriendFeedPost;
  onChanged: (relationship: FeedRelationship) => void;
}) {
  if (
    !post.relationship ||
    post.relationship === "self" ||
    post.relationship === "friends"
  )
    return null;
  if (post.relationship === "incoming_pending" && !post.requestId) return null;
  return (
    <FriendAction
      userId={post.author.id}
      status={status[post.relationship]}
      requestId={post.requestId ?? undefined}
      onCancel={() => cancelFriendRequest(post.author.id)}
      onChanged={state => {
        onChanged(relationship[state]);
        invalidateSocialUnread();
      }}
      adapter={adapter}
    />
  );
}
