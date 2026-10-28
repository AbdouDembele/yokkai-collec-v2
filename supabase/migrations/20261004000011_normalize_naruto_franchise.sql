begin;

update public.cards
set franchise = 'Naruto'
where lower(btrim(franchise)) = 'naruto: shippuden';

commit;
