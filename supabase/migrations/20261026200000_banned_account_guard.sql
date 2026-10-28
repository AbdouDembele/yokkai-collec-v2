begin;
set local lock_timeout='3s';

-- #374: deleting Auth sessions does not revoke an access token already issued.
-- Every player mutation therefore checks the caller's live ban state itself.
-- No caller (service_role, cron, migrations): nothing to check.
create function public.assert_player_not_banned() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists(
    select 1 from auth.users u
    where u.id=auth.uid()
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')>now()
  ) then
    raise exception 'ACCOUNT_BANNED' using errcode='P0001';
  end if;
  return true;
end $$;
revoke all on function public.assert_player_not_banned() from public,anon,service_role;
grant execute on function public.assert_player_not_banned() to authenticated;

-- Prefix each mutating RPC with the guard, keeping its signature, owner, ACL,
-- SECURITY DEFINER and search_path. The original plpgsql body becomes a nested
-- block, so its declarations, RETURN and EXCEPTION clauses are unchanged.
-- A later migration redefining one of these functions must keep the first call;
-- tests/banned-account-guard-db.test.mjs fails otherwise.
do $guard$
declare
  target regprocedure;
  fn record;
  body text;
begin
  foreach target in array array[
    'public.add_binder_to_wishlist(text)',
    'public.admin_delete_card(uuid)',
    'public.admin_delete_cards(uuid[])',
    'public.admin_delete_reported_wall_content(uuid)',
    'public.admin_remove_player_card(uuid)',
    'public.admin_set_card_report_status(uuid,text)',
    'public.admin_set_report_status(uuid,text)',
    'public.admin_set_user_ban(uuid,boolean)',
    'public.block_user(uuid)',
    'public.cancel_auction(uuid)',
    'public.cancel_friend_request(uuid)',
    'public.cancel_trade_offer(uuid)',
    'public.claim_achievement(text)',
    'public.create_auction(uuid,integer,integer)',
    'public.create_card_share(uuid,boolean)',
    'public.create_folder(text)',
    'public.create_referral_code()',
    'public.create_trade_offer(uuid,uuid[],integer,uuid[],integer,uuid)',
    'public.delete_card_share(text)',
    'public.delete_folder(uuid)',
    'public.delete_profile_wall_post(uuid)',
    'public.delete_wall_post_reply(uuid,uuid)',
    'public.discard_collection_card(uuid)',
    'public.discard_collection_cards(uuid[])',
    'public.discard_decision_pack()',
    'public.discard_decision_pack_card(uuid)',
    'public.discard_regular_pack_card(uuid)',
    'public.evolve_lr_card(uuid[])',
    'public.evolve_ssr_card(uuid[])',
    'public.keep_decision_pack_card(uuid)',
    'public.mark_notification_read(uuid)',
    'public.mark_offline()',
    'public.mark_private_messages_read(uuid,uuid)',
    'public.move_card_to_folder(uuid,uuid)',
    'public.move_cards_to_folder(uuid[],uuid)',
    'public.open_decision_pack()',
    'public.open_regular_pack()',
    'public.open_regular_packs(integer)',
    'public.place_bid(uuid,integer)',
    'public.publish_profile_wall_post(uuid,text,text,text)',
    'public.publish_wall_post_reply(uuid,uuid,text)',
    'public.publish_wall_post_reply_media(uuid,uuid,text,text,text)',
    'public.remove_friend(uuid)',
    'public.report_card(uuid,text)',
    'public.report_user(uuid,text,text,uuid,text,boolean)',
    'public.resolve_binder_favorite(text,text[])',
    'public.respond_friend_request(uuid,boolean)',
    'public.respond_trade_offer(uuid,text)',
    'public.send_auction_chat_message(uuid,text,text)',
    'public.send_friend_request(uuid)',
    'public.send_private_message(uuid,text,uuid)',
    'public.send_private_message_gif(uuid,text,uuid,text)',
    'public.set_binder_favorite(text,boolean)',
    'public.set_card_custom_image(uuid,text)',
    'public.set_collection_card_locked(uuid,boolean)',
    'public.set_profile_binder_widgets(jsonb)',
    'public.set_profile_like(uuid,boolean)',
    'public.set_profile_privacy(boolean)',
    'public.set_wall_post_like(uuid,boolean)',
    'public.set_wall_post_reaction(uuid,text,boolean)',
    'public.toggle_auction_watch(uuid)',
    'public.toggle_wishlist(uuid)',
    'public.touch_presence()',
    'public.unblock_user(uuid)',
    'public.update_profile(text,text,uuid[],uuid)',
    'public.update_profile_appearance(text,text,uuid[],uuid,text)',
    'public.update_profile_appearance_framed(text,text,uuid[],uuid,text,jsonb)',
    'public.update_profile_interests(jsonb)',
    'public.update_profile_widgets(jsonb)'
  ]::regprocedure[] loop
    select p.prosrc, l.lanname, pg_get_functiondef(p.oid) as def into fn
    from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target;
    body := case fn.lanname
      when 'plpgsql' then E'\nbegin\n  perform public.assert_player_not_banned();\n'
        || regexp_replace(fn.prosrc, ';?\s*$', '') || E';\nend\n'
      when 'sql' then E'\n  select public.assert_player_not_banned();' || fn.prosrc
    end;
    if body is null or array_length(string_to_array(fn.def, fn.prosrc), 1)<>2 then
      raise exception 'Cannot guard %', target;
    end if;
    execute replace(fn.def, fn.prosrc, body);
  end loop;
end $guard$;

-- Direct uploads bypass RPCs: refuse every Storage write from a banned token.
create policy storage_writes_require_unbanned_insert on storage.objects as restrictive
  for insert to authenticated with check ((select public.assert_player_not_banned()));
create policy storage_writes_require_unbanned_update on storage.objects as restrictive
  for update to authenticated using ((select public.assert_player_not_banned()))
  with check ((select public.assert_player_not_banned()));

-- Only player-owned table still writable through PostgREST (admin tables excluded:
-- admins cannot be banned).
create policy panini_album_favorites_require_unbanned_insert on public.panini_album_favorites as restrictive
  for insert to authenticated with check ((select public.assert_player_not_banned()));
create policy panini_album_favorites_require_unbanned_delete on public.panini_album_favorites as restrictive
  for delete to authenticated using ((select public.assert_player_not_banned()));

commit;
