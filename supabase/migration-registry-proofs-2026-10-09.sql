-- Trace historique en lecture seule : 2026-10-09, Africa/Casablanca.
-- Versions 20261007000004 et 20261007000005 ; résultats observés en production.
-- Uniquement SELECT, exécutés avec default_transaction_read_only=on.
-- Ce fichier n’est PAS une migration et n’est PAS exécuté par le déploiement.
-- Une réimportation légitime ultérieure ne doit pas invalider ces exceptions.
-- Les résultats prouvent les postconditions du catalogue à cette date,
-- sans prouver la date d’exécution ni reconstruire les anciens UUID supprimés.
-- Résultats (ordre des requêtes ci-dessous) :
-- {"check":"kingdom_deleted_targets","remaining_cards":0}
-- {"check":"dragon_ball_deleted_targets","remaining_cards":0}
-- {"check":"dragon_ball_old_franchise","remaining_cards":0}
-- {"check":"dragon_ball_names_1","matched_rows":3,"incorrect_names":0}
-- {"check":"dragon_ball_names_2","matched_rows":1,"incorrect_names":0}
-- {"check":"dragon_ball_names_3","matched_rows":38,"incorrect_names":0}

-- 20261007000004 : absence des cartes Kingdom ciblées.
SELECT json_build_object('check','kingdom_deleted_targets','remaining_cards',count(*)) FROM public.cards WHERE franchise='Kingdom Season 2' OR (franchise='Kingdom' AND source='anilist');
SELECT json_build_object('check','dragon_ball_deleted_targets','remaining_cards',count(*)) FROM public.cards WHERE source='anilist' AND source_id IN ('2147','4318','2093','2104','2551');
SELECT json_build_object('check','dragon_ball_old_franchise','remaining_cards',count(*)) FROM public.cards WHERE franchise='Dragon Ball Z';
SELECT json_build_object('check','dragon_ball_names_1','matched_rows',count(*),'incorrect_names',count(*) FILTER (WHERE nom IS DISTINCT FROM (case source_id
  when '2150' then 'C-13'
  when '2149' then 'C-14'
  when '2148' then 'C-15'
end))) FROM public.cards WHERE franchise = 'Dragon Ball Z: Super Android 13!'
  and source = 'anilist'
  and source_id in ('2150', '2149', '2148');
SELECT json_build_object('check','dragon_ball_names_2','matched_rows',count(*),'incorrect_names',count(*) FILTER (WHERE nom IS DISTINCT FROM ('C-19'))) FROM public.cards WHERE franchise = 'Dragon Ball'
  and source = 'anilist'
  and source_id = '6115';
SELECT json_build_object('check','dragon_ball_names_3','matched_rows',count(*),'incorrect_names',count(*) FILTER (WHERE nom IS DISTINCT FROM (case source_id
  when '2114' then 'DIABLEMAN'
  when '2110' then 'BABA LA VOYANTE'
  when '2103' then 'DR BRIEF'
  when '2107' then 'MADAME BRIEF'
  when '315769' then U&'PR\00C9SENTATEUR DU CELL GAME'
  when '32466' then 'ROI COLD'
  when '41526' then 'GRAND KAIO'
  when '9780' then 'GRAND KAIO SHIN'
  when '9773' then 'ROI ENMA'
  when '3694' then 'FREEZER'
  when '246' then 'SON GOKU'
  when '2094' then 'GYUMAO'
  when '41528' then 'KAIO DE L''EST'
  when '6133' then 'KAIO SHIN DE L''EST'
  when '2099' then 'C-16'
  when '2098' then 'C-8'
  when '4850' then 'KAIO DU NORD'
  when '148620' then 'KAIO SHIN DU NORD'
  when '2159' then 'KRILIN'
  when '1012' then 'BOO'
  when '2134' then 'SERGENT METALLIC'
  when '41529' then 'KAIO DU SUD'
  when '9377' then 'MR. SATAN'
  when '41888' then U&'GAR\00C7ON AVEUGLE'
  when '6167' then U&'TORTUE G\00C9NIALE'
  when '41527' then 'KAIO DE L''OUEST'
  when '40489' then 'FERMIER'
  when '332777' then U&'GRAND-M\00C8RE PAOZU'
  when '6293' then 'VIEUX KAIO SHIN'
  when '2115' then 'OURS BANDIT'
  when '6127' then 'SHENRON'
  when '2109' then U&'PR\00C9SENTATEUR DU TENKAICHI BUDOKAI'
  when '2130' then U&'MA\00CETRE DES GRUES'
  when '2112' then 'TORTUE'
  when '9393' then 'ROI VEGETA'
  when '21344' then 'ROI NIKOCHAN'
  when '332776' then 'MEMBRE DU GANG DES LAPINS'
  when '332778' then 'MEMBRE DU GANG DES LAPINS'
end))) FROM public.cards WHERE franchise = 'Dragon Ball'
  and source = 'anilist'
  and source_id in (
    '2114','2110','2103','2107','315769','32466','41526','9780','9773',
    '3694','246','2094','41528','6133','2099','2098','4850','148620',
    '2159','1012','2134','41529','9377','41888','6167','41527','40489',
    '332777','6293','2115','6127','2109','2130','2112','9393','21344',
    '332776','332778'
  );
