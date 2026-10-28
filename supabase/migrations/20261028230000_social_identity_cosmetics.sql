begin;
do $migration$
declare target regprocedure; definition text; previous text; replacement text; expected integer; edits record;
begin
 for edits in select * from (values
  ('public.get_friendships()', '''avatarUrl'',p.avatar_url', '''avatarUrl'',p.avatar_url,''profileStyle'',public.billing_profile_cosmetics(p.user_id)',3),
  ('public.search_users(text)', '''avatarUrl'',p.avatar_url', '''avatarUrl'',p.avatar_url,''profileStyle'',public.billing_profile_cosmetics(p.user_id)',1),
  ('public.get_friendships_page(jsonb,integer)', '''avatarUrl'',avatar_url', '''avatarUrl'',avatar_url,''profileStyle'',public.billing_profile_cosmetics(user_id)',2),
  ('public.get_private_conversations(timestamp with time zone,uuid,integer)', '''avatarUrl'',avatar_url', '''avatarUrl'',avatar_url,''profileStyle'',public.billing_profile_cosmetics(friend_id)',1)
 )patch(signature,previous,replacement,expected) loop
  target:=edits.signature::regprocedure;
  definition:=pg_get_functiondef(target);
  if array_length(string_to_array(definition,edits.previous),1)<>edits.expected+1 then
   raise exception 'SOCIAL_COSMETICS_DEFINITION_CHANGED: %',target;
  end if;
  execute replace(definition,edits.previous,edits.replacement);
 end loop;
end $migration$;
-- CREATE OR REPLACE preserves the existing authenticated-only ACLs.
notify pgrst,'reload schema';
commit;
