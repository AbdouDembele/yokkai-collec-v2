"use client";

import Link from "next/link";
import { redirect } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ProfileWall } from "@/components/profile-wall";
import { Button, Skeleton } from "@/components/ui";
import { getProfile, type Profile } from "@/lib/data/profile";
import { useSocialFeeds } from "@/components/social-feed-provider";
import { EveryoneFriendAction } from "@/components/everyone-friend-action";
import { startVisiblePolling } from "@/lib/ui/visible-polling";

export function SocialFeed({
  source = "friends"
}: {
  source?: "friends" | "public";
}) {
  const store = useSocialFeeds()[source];
  const everyone = source === "public";
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const [viewer, setViewer] = useState<Profile>();
  const [profileError, setProfileError] = useState("");
  useEffect(() => {
    let active = true;
    const loadViewer = () => {
      void getProfile().then(
        profile => {
          if (active) setViewer(profile);
        },
        () => {
          if (active)
            setProfileError(
              "Couldn't load your profile. Refresh to publish a post."
            );
        }
      );
    };
    const refresh = (resumed = false) => {
      if (!document.hidden) {
        void store.refresh();
        if (resumed) loadViewer();
      }
    };
    const stop = startVisiblePolling(refresh, 60_000);
    const reloadViewer = () => {
      if (!document.hidden) loadViewer();
    };
    window.addEventListener("player-block-changed", reloadViewer);
    return () => {
      active = false;
      stop();
      store.dispose();
      window.removeEventListener("player-block-changed", reloadViewer);
    };
  }, [store]);
  if (everyone && state.available === false) redirect("/social");
  return (
    <section
      className="yk-social-stack"
      aria-label={everyone ? "Everyone feed" : "Friend feed"}
    >
      {everyone && viewer && !viewer.isPublic && (
        <div className="yk-profile-notice">
          <p>
            Your profile is private: your posts are only visible to your friends
            and won&apos;t appear in Everyone.
          </p>
          <Link className="underline" href="/settings">
            Privacy settings
          </Link>
        </div>
      )}
      {viewer && (
        <ProfileWall
          ownerId={viewer.id}
          pseudo={viewer.pseudo}
          avatarUrl={viewer.avatarUrl}
          isMe
          isPublic={viewer.isPublic}
          canRead
          active
          composerOnly
          onPublished={post => {
            if (everyone && !viewer.isPublic) return;
            store.published({
              ...post,
              hasMedia: !!post.mediaPath,
              author: {
                id: viewer.id,
                name: viewer.pseudo,
                avatarUrl: viewer.avatarUrl,
                profileStyle: viewer.profileStyle
              }
            });
          }}
        />
      )}
      {profileError && <p role="alert">{profileError}</p>}
      {!!state.pending.length && (
        <Button
          disabled={state.loadingMore}
          onClick={() => {
            store.showNew();
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
        >
          New posts
        </Button>
      )}
      {state.loading && (
        <Skeleton
          label="Loading your feed"
          className="h-48 w-full rounded-panel"
        />
      )}
      {state.error && (
        <div role="alert" className="yk-profile-notice">
          <p>{state.error}</p>
          <Button
            variant="secondary"
            onClick={() => {
              store.clear();
              void store.refresh();
            }}
          >
            Refresh feed
          </Button>
        </div>
      )}
      {state.loaded && viewer && !state.items.length && !state.error && (
        <div className="yk-profile-surface yk-wall-empty">
          <h2>
            {everyone
              ? "No public posts yet"
              : viewer?.friends.length
                ? "Share the first story"
                : "Your circle starts here"}
          </h2>
          <p>
            {everyone
              ? "Publish a post on your public wall to start the conversation."
              : viewer?.friends.length
                ? "Publish a post on your wall to start the conversation."
                : "Find friends or publish your first post to start your feed."}
          </p>
          {!everyone && !viewer?.friends.length && (
            <Link className="yk-button" href="/social/friends">
              Find friends
            </Link>
          )}
        </div>
      )}
      <div className="yk-wall-posts">
        {state.items.map(post => (
          <ProfileWall
            key={post.id}
            feedPost={{
              ...post,
              mediaPath: null,
              profileStyle: post.author.profileStyle ?? undefined
            }}
            ownerId={post.author.id}
            pseudo={post.author.name}
            avatarUrl={post.author.avatarUrl}
            authorAction={
              everyone && (
                <EveryoneFriendAction
                  key={`${post.author.id}:${post.relationship}:${post.requestId ?? ""}`}
                  post={post}
                  onChanged={relationship =>
                    store.relationshipChanged(post.author.id, relationship)
                  }
                />
              )
            }
            isMe={viewer?.id === post.author.id}
            isPublic={everyone}
            canRead
            active
            canInteract
            initialActivity={post.activity}
            canReport={!!viewer}
            onDeleted={store.removed}
          />
        ))}
      </div>
      {state.next && (
        <Button
          variant="secondary"
          disabled={state.loadingMore}
          onClick={() => void store.more()}
        >
          {state.loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
      {state.loaded && state.items.length > 0 && !state.next && (
        <p role="status" className="yk-profile-muted">
          You&apos;re all caught up.
        </p>
      )}
    </section>
  );
}
