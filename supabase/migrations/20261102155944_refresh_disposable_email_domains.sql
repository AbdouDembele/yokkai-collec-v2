begin;

-- Public-source domain policy refresh; no user data is read or modified.
insert into public.signup_email_domain_rules(domain,allowed) values
('10timer.com',false),
('afuyo.com',false),
('aiqseo.com',false),
('birdharbor.me',false),
('brewlyric.me',false),
('craftmirth.me',false),
('diceparlor.me',false),
('dioramafern.me',false),
('emailfutureme.com',false),
('emman.my.id',false),
('etymoasis.me',false),
('hadjoy.com',false),
('kiwof.com',false),
('litedl.com',false),
('lugiz.com',false),
('mail123.fr',false),
('mythmarsh.me',false),
('ogcover.com',false),
('phuturemail.com',false),
('qdoit.com',false),
('runpebble.me',false),
('shelfsonnet.me',false),
('smaau.com',false),
('soundattic.me',false),
('stgodanang.com',false),
('swapagrawal.work.gd',false),
('tempemail.co',false),
('thriftmorrow.me',false),
('tinyroomlife.me',false),
('xeramail.com',false)
on conflict(domain) do update set allowed=excluded.allowed;

commit;
