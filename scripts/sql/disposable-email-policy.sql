begin;

-- Global public-source policy data; never contains addresses or player records.
create table public.signup_email_domain_rules (
  domain text primary key check (char_length(domain) between 3 and 253),
  allowed boolean not null
);
alter table public.signup_email_domain_rules enable row level security;
revoke all on public.signup_email_domain_rules from public, anon, authenticated, service_role;

-- @DOMAIN_RULES@

create function public.signup_email_domain(p_email text)
returns text language plpgsql immutable set search_path = '' as $$
declare value text := btrim(p_email, E' \t\r\n\v\f'); domain text;
begin
  if value is null or char_length(value)>254 or value !~ '^[^[:space:]@]+@[^[:space:]@]+$' then return null; end if;
  domain := lower(normalize(split_part(value,'@',2), NFKC));
  -- IDNA-ignored formatting characters; contextual joiners are deliberately excluded.
  domain := regexp_replace(domain collate "C", U&'[\00AD\034F\115F-\1160\17B4-\17B5\180B-\180F\200B\2060-\2064\206A-\206F\3164\FE00-\FE0F\FEFF\FFA0\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0100-\+0E01EF]', '', 'g');
  domain := rtrim(translate(domain,U&'\3002\FF0E\FF61','...'),'.');
  if char_length(domain)>253 or domain collate "C" !~ U&'^[a-z0-9\0080-\+10FFFF]([a-z0-9.\0080-\+10FFFF-]*[a-z0-9\0080-\+10FFFF])?$'
    or domain not like '%.%' or domain like '%..%' then return null; end if;
  return domain;
end; $$;
revoke all on function public.signup_email_domain(text) from public, anon, authenticated, service_role;

create function public.is_disposable_email(p_email text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare email_domain text := public.signup_email_domain(p_email); labels text[];
begin
  if email_domain is null then return false; end if;
  -- Only an exact allowlist entry wins; it never exempts an unrelated suffix.
  if exists(select 1 from public.signup_email_domain_rules r where r.domain=email_domain and r.allowed) then return false; end if;
  labels := string_to_array(email_domain,'.');
  return exists(select 1 from public.signup_email_domain_rules r
    where not r.allowed and r.domain = any(array(
      select array_to_string(labels[i:cardinality(labels)],'.')
      from generate_subscripts(labels,1) i where i<cardinality(labels)
    )));
end; $$;
revoke all on function public.is_disposable_email(text) from public, anon, authenticated, service_role;

create function public.guard_disposable_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare labels text[]; rejected_domain text;
begin
  -- JSON access preserves older replay fixtures and non-email Auth providers.
  if public.is_disposable_email(to_jsonb(new)->>'email') then
    labels:=string_to_array(public.signup_email_domain(to_jsonb(new)->>'email'),'.');
    select r.domain into rejected_domain from public.signup_email_domain_rules r
      where not r.allowed and r.domain=any(array(select array_to_string(labels[i:cardinality(labels)],'.') from generate_subscripts(labels,1) i where i<cardinality(labels)))
      order by char_length(r.domain) desc limit 1;
    -- Log only the public blocked rule, never an attacker-chosen subdomain.
    raise log 'signup_rejected_disposable_email domain=%', encode(convert_to(rejected_domain,'UTF8'),'escape');
    raise exception 'DISPOSABLE_EMAIL_NOT_ALLOWED' using errcode='P0001';
  end if;
  return new;
end; $$;
revoke all on function public.guard_disposable_signup() from public, anon, authenticated, service_role;

-- INSERT only: no retroactive ban, no changes to login, confirmation or recovery.
create trigger before_auth_user_created_disposable_email
  before insert on auth.users for each row execute function public.guard_disposable_signup();

commit;
