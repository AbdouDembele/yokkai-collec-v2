begin;
set local lock_timeout='3s';

-- Keep owner deletion and exact-object cleanup receipts. Administrators can
-- moderate a post directly from the feed without creating a synthetic report.
create or replace function public.delete_profile_wall_post(p_id uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; author_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  if not public.can_read_profile_wall(auth.uid()) then raise exception 'WALL_UNAVAILABLE'; end if;
  select user_id into author_id from public.profile_wall_posts where id=p_id for update;
  if found then
    if author_id<>auth.uid() and not public.is_current_user_admin() then
      raise exception 'WALL_POST_NOT_FOUND';
    end if;
    result:=public.delete_wall_content_core('wall_post',p_id);
    if author_id<>auth.uid() then
      insert into public.admin_audit_logs(admin_user_id,action,metadata)
        values(auth.uid(),'wall_content.delete',jsonb_build_object(
          'target_user_id',author_id,'context_type','wall_post','context_id',p_id,
          'mediaPaths',result->'mediaPaths'));
    end if;
  else
    select jsonb_build_object('alreadyDeleted',true,'mediaPaths',coalesce(jsonb_agg(media_path),'[]'::jsonb)) into result
      from public.wall_reply_media_cleanup where user_id=auth.uid() and content_type='wall_post' and content_id=p_id;
  end if;
  return result::text;
end; $$;

revoke all on function public.delete_profile_wall_post(uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_profile_wall_post(uuid) to authenticated;
commit;
