begin;

alter table public.user_profiles
  add column avatar_url text,
  add column bio text not null default '' check (char_length(bio) <= 300),
  add column featured_card_ids uuid[] not null default '{}'::uuid[]
    check (cardinality(featured_card_ids) <= 4);

create unique index user_profiles_pseudo_ci_key on public.user_profiles (lower(pseudo));

-- Only harmless public fields can be read directly. Private game state remains behind RPCs.
revoke select on public.user_profiles from authenticated;
grant select (user_id,pseudo,avatar_url,bio,featured_card_ids) on public.user_profiles to authenticated;
drop policy if exists user_profiles_read_own on public.user_profiles;
create policy user_profiles_read_authenticated on public.user_profiles
  for select to authenticated using (true);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',true,2097152,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=true,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id='avatars' and owner_id=(select auth.uid())::text)
  with check (bucket_id='avatars' and owner_id=(select auth.uid())::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id='avatars' and owner_id=(select auth.uid())::text);

create or replace function public.profile_card_json(c public.cards,uc public.user_cards)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',c.id,'name',c.nom,'category',c.categorie,'anime',c.franchise,
    'rarity',c.rarete_base,'image',c.image_url,'instanceId',uc.id,'obtainedAt',uc.date_obtention,
    'shiny',uc.is_shiny,'isEvolved',uc.is_evolved,'isFirstOwner',uc.is_first_owner,'folderId',uc.folder_id)
$$;
revoke all on function public.profile_card_json(public.cards,public.user_cards) from public,anon,authenticated;

create or replace function public.get_profile(p_identifier text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); target public.user_profiles%rowtype; result jsonb;
begin
  if viewer is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if p_identifier is null or btrim(p_identifier)='' then
    select * into target from public.user_profiles where user_id=viewer;
  else
    select * into target from public.user_profiles
      where lower(pseudo)=lower(btrim(p_identifier))
         or user_id=case when p_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then p_identifier::uuid else null end
      limit 1;
  end if;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  select jsonb_build_object(
    'id',target.user_id,'pseudo',target.pseudo,'avatarUrl',target.avatar_url,'bio',target.bio,
    'friendshipStatus',case when target.user_id=viewer then 'self' else public.friendship_state(viewer,target.user_id) end,
    'featuredCards',coalesce((select jsonb_agg(public.profile_card_json(c,uc) order by pos)
      from unnest(target.featured_card_ids) with ordinality picked(instance_id,pos)
      join public.user_cards uc on uc.id=picked.instance_id and uc.user_id=target.user_id
      join public.cards c on c.id=uc.card_id),'[]'::jsonb),
    'friends',coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'pseudo',p.pseudo,'avatarUrl',p.avatar_url) order by lower(p.pseudo))
      from public.friendships f join public.user_profiles p
        on p.user_id=case when f.user_id=target.user_id then f.friend_id else f.user_id end
      where f.status='accepted' and (f.user_id=target.user_id or f.friend_id=target.user_id)),'[]'::jsonb),
    'cardCount',(select count(*) from public.user_cards where user_id=target.user_id),
    'distinctCardCount',(select count(distinct card_id) from public.user_cards where user_id=target.user_id)
  ) into result;
  return result;
end; $$;

create or replace function public.update_profile(p_bio text,p_avatar_url text,p_featured_card_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare player_id uuid:=auth.uid(); cleaned_ids uuid[]:=coalesce(p_featured_card_ids,'{}'::uuid[]);
begin
  if player_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if char_length(coalesce(p_bio,''))>300 then raise exception 'BIO_TOO_LONG' using errcode='P0001'; end if;
  if cardinality(cleaned_ids)>4 or cardinality(cleaned_ids)<>(select count(distinct x) from unnest(cleaned_ids) x)
    then raise exception 'FEATURED_CARDS_INVALID' using errcode='P0001'; end if;
  if exists(select 1 from unnest(cleaned_ids) x where not exists(
    select 1 from public.user_cards uc where uc.id=x and uc.user_id=player_id))
    then raise exception 'CARD_NOT_OWNED' using errcode='P0001'; end if;
  update public.user_profiles set bio=coalesce(p_bio,''),avatar_url=nullif(btrim(p_avatar_url),''),featured_card_ids=cleaned_ids
    where user_id=player_id;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return public.get_profile(null);
end; $$;

revoke all on function public.get_profile(text),public.update_profile(text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.get_profile(text),public.update_profile(text,text,uuid[]) to authenticated;

commit;
