begin;
set local lock_timeout='5s';

-- Extend the existing allowed types without dropping any earlier notification.
do $$ declare definition text;begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.notifications'::regclass and conname='notifications_type_check';
  if definition is null then raise exception 'NOTIFICATION_CONSTRAINT_MISSING';end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute 'alter table public.notifications add constraint notifications_type_check check (type=''friend_request_accepted'' or ('||substring(definition from 8 for char_length(definition)-8)||'))';
end $$;

-- Keep every authentication, ban, pair-lock, deletion and pending-state guard.
-- This executes only after the pending request was successfully accepted.
do $accept$ declare original text; changed text; marker text:='    -- A mutually accepted relationship';begin
  original:=pg_get_functiondef('public.respond_friend_request(uuid,boolean)'::regprocedure);
  if (length(original)-length(replace(original,marker,''))) / length(marker) <> 1 then
    raise exception 'FRIEND_ACCEPT_NOTIFICATION_PATCH_MISMATCH';
  end if;
  changed:=replace(original,marker,$notification$
    insert into public.notifications(user_id,type,reference_id,actor_user_id,created_at)
      values(sender_id,'friend_request_accepted',player_id,player_id,clock_timestamp())
      on conflict(user_id,type,reference_id) do update
        set actor_user_id=excluded.actor_user_id,read_at=null,created_at=excluded.created_at;
    -- A mutually accepted relationship$notification$);
  execute changed;
end $accept$;

-- The same resolver protects bell reads, push delivery and block cleanup.
-- The accepter is persisted as actor, so a later friendship removal cannot
-- accidentally turn this into a notification from the request sender.
do $actor$ declare original text; changed text; marker text:='when n.type=''friend_request'' then';begin
  original:=pg_get_functiondef('public.interaction_notification_actor(public.notifications)'::regprocedure);
  if (length(original)-length(replace(original,marker,''))) / length(marker) <> 1 then
    raise exception 'FRIEND_ACCEPT_ACTOR_PATCH_MISMATCH';
  end if;
  changed:=replace(original,marker,'when n.type=''friend_request_accepted'' then n.actor_user_id '||marker);
  execute changed;
end $actor$;
notify pgrst,'reload schema';
commit;
