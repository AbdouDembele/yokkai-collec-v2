-- #379 (C2): GIFs posted by players must carry a GIPHY rating of g, pg or pg-13.
-- The rating is not part of the URL: a trusted server route reads it from the
-- GIPHY API and records it here; every GIF write by a player checks this table.
-- Code: GIF_RATING_REJECTED (unknown GIF, unreadable URL or rating above pg-13).
-- GIFs already published are not checked or removed by this migration.
begin;

create table public.giphy_gif_ratings (
  gif_id text primary key check (gif_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  rating text not null check (rating ~ '^[a-z0-9-]{1,16}$'),
  verified_at timestamptz not null default clock_timestamp()
);
alter table public.giphy_gif_ratings enable row level security;
revoke all on table public.giphy_gif_ratings from public,anon,authenticated,service_role;

-- Server route only (service_role): upsert the rating GIPHY returned for an id.
create function public.record_giphy_gif_rating(p_gif_id text,p_rating text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare clean text:=lower(btrim(coalesce(p_rating,'')));
begin
  if p_gif_id is null or p_gif_id !~ '^[A-Za-z0-9_-]{1,64}$' or clean !~ '^[a-z0-9-]{1,16}$'
    then raise exception 'GIF_INVALID' using errcode='P0001'; end if;
  insert into public.giphy_gif_ratings(gif_id,rating,verified_at) values(p_gif_id,clean,clock_timestamp())
    on conflict(gif_id) do update set rating=excluded.rating,verified_at=excluded.verified_at;
  return clean in ('g','pg','pg-13');
end; $$;

-- Player writes only (a JWT subject is present); the GIF id is the path segment
-- before the file name, e.g. https://media2.giphy.com/media/v1.x/<id>/giphy.gif.
create function public.guard_gif_rating()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.gif_url is null or auth.uid() is null
    or (tg_op='UPDATE' and new.gif_url is not distinct from old.gif_url) then return new; end if;
  if not exists(select 1 from public.giphy_gif_ratings
    where gif_id=substring(new.gif_url from '^https://(?:media[0-9]*|i)\.giphy\.com/media/(?:[^/?#]+/)*([A-Za-z0-9_-]{1,64})/[A-Za-z0-9_.-]+\.gif(?:\?[^#]*)?$')
      and rating in ('g','pg','pg-13'))
    then raise exception 'GIF_RATING_REJECTED' using errcode='P0001'; end if;
  return new;
end; $$;

create trigger guard_gif_rating before insert or update of gif_url on public.private_messages
  for each row execute function public.guard_gif_rating();
create trigger guard_gif_rating before insert or update of gif_url on public.profile_wall_posts
  for each row execute function public.guard_gif_rating();
create trigger guard_gif_rating before insert or update of gif_url on public.wall_post_replies
  for each row execute function public.guard_gif_rating();
create trigger guard_gif_rating before insert or update of gif_url on public.auction_chat_messages
  for each row execute function public.guard_gif_rating();

revoke all on function public.record_giphy_gif_rating(text,text),public.guard_gif_rating()
  from public,anon,authenticated,service_role;
grant execute on function public.record_giphy_gif_rating(text,text) to service_role;
notify pgrst,'reload schema';
commit;
