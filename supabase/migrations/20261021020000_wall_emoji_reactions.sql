begin;
create table public.wall_post_reactions (
  post_id uuid not null references public.profile_wall_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check(emoji=any(array['thumbs-up','heart','fire','laugh','eyes','sparkles','hundred','party',
    'smile','heart-eyes','wow','cry','mind-blown','cool','skull','thinking','salute','clap','raised-hands','handshake','diamond','heart-hands','trophy','star'])),
  created_at timestamptz not null default clock_timestamp(),
  primary key(post_id,user_id,emoji)
);
create index wall_post_reactions_author on public.wall_post_reactions(user_id,created_at);
alter table public.wall_post_reactions enable row level security;
revoke all on public.wall_post_reactions from public,anon,authenticated,service_role;

alter function public.get_wall_post_activity(uuid,timestamptz,uuid) rename to get_wall_post_activity_without_reactions;
revoke all on function public.get_wall_post_activity_without_reactions(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
create function public.get_wall_post_activity(p_post_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  select public.get_wall_post_activity_without_reactions(p_post_id,p_before,p_before_id) || jsonb_build_object(
    'reactions',coalesce((select jsonb_agg(jsonb_build_object('emoji',emoji,'count',n,'reactedByMe',mine) order by n desc,emoji)
      from (select emoji,count(*) n,bool_or(user_id=auth.uid()) mine from public.wall_post_reactions
        where post_id=p_post_id and public.wall_actor_visible(user_id) group by emoji) counts),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.get_wall_post_activity(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_wall_post_activity(uuid,timestamptz,uuid) to authenticated;

create function public.set_wall_post_reaction(p_post_id uuid,p_emoji text,p_reacted boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('account-deletion:'||auth.uid()::text,0));
  perform pg_advisory_xact_lock(hashtextextended('wall-interactions:'||auth.uid()::text,0));
  perform public.wall_interaction_owner(p_post_id);
  if p_reacted is null or p_emoji is null or p_emoji<>all(array['thumbs-up','heart','fire','laugh','eyes','sparkles','hundred','party',
    'smile','heart-eyes','wow','cry','mind-blown','cool','skull','thinking','salute','clap','raised-hands','handshake','diamond','heart-hands','trophy','star'])
    then raise exception 'WALL_REACTION_INVALID'; end if;
  if p_reacted then
    if not exists(select 1 from public.wall_post_reactions where post_id=p_post_id and user_id=auth.uid() and emoji=p_emoji)
      and (select count(*) from public.wall_post_reactions where post_id=p_post_id and user_id=auth.uid())>=8
      then raise exception 'WALL_REACTION_LIMIT'; end if;
    insert into public.wall_post_reactions(post_id,user_id,emoji) values(p_post_id,auth.uid(),p_emoji) on conflict do nothing;
  else delete from public.wall_post_reactions where post_id=p_post_id and user_id=auth.uid() and emoji=p_emoji; end if;
  return public.get_wall_post_activity(p_post_id);
end; $$;
revoke all on function public.set_wall_post_reaction(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_wall_post_reaction(uuid,text,boolean) to authenticated;

create function public.cleanup_wall_reactions() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.wall_post_reactions where user_id=new.user_id;
  return new;
end; $$;
revoke all on function public.cleanup_wall_reactions() from public,anon,authenticated,service_role;
create trigger cleanup_wall_reactions after insert on public.account_deletion_log
  for each row execute function public.cleanup_wall_reactions();

alter function public.build_data_export(uuid,uuid) rename to build_data_export_without_reactions;
revoke all on function public.build_data_export_without_reactions(uuid,uuid) from public,anon,authenticated,service_role;
create function public.build_data_export(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
  select public.build_data_export_without_reactions(p_user_id,p_request_id) || jsonb_build_object(
    'wall_post_reactions',coalesce((select jsonb_agg(jsonb_build_object('post_id',post_id,'emoji',emoji,'created_at',created_at))
      from (select post_id,emoji,created_at from public.wall_post_reactions where user_id=p_user_id limit 100001) r),'[]'::jsonb)
  ) into result;
  if (select coalesce(sum(case when jsonb_typeof(value)='array' then jsonb_array_length(value)
      when jsonb_typeof(value)='object' then 1 else 0 end),0) from jsonb_each(result))>100000
    or octet_length(result::text)>26214400 then raise exception 'EXPORT_TOO_LARGE'; end if;
  return result;
end; $$;
revoke all on function public.build_data_export(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.build_data_export(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
