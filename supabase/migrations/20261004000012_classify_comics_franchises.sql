begin;

update public.cards
set franchise = case
  when upper(btrim(nom)) = any (array[
    'AMBER BENNETT',
    'ANISSA',
    'ATOM EVE — SAMANTHA EVE WILKINS',
    'BATTLE BEAST',
    'CECIL STEDMAN',
    'DEBBIE GRAYSON',
    'KREGG',
    'MONSTER GIRL — AMANDA',
    'OLIVER GRAYSON',
    'REX SPLODE — REX SLOAN',
    'ROBOT — RUDY CONNORS',
    'THE IMMORTAL',
    'THRAGG'
  ]) then 'Invincible'
  when upper(btrim(nom)) = any (array[
    'AQUAMAN',
    'BANE',
    'BATGIRL',
    'BATMAN',
    'CATWOMAN',
    'CYBORG',
    'DARKSEID',
    'GREEN ARROW',
    'GREEN LANTERN',
    'HARLEY QUINN',
    'JOKER',
    'LEX LUTHOR',
    'NIGHTWING',
    'POISON IVY',
    'REVERSE-FLASH',
    'ROBIN',
    'SUPERGIRL',
    'SUPERMAN',
    'THE FLASH',
    'THE RIDDLER',
    'WONDER WOMAN'
  ]) then 'DC Comics'
  when upper(btrim(nom)) like 'TEENAGE MUTANT NINJA TURTLES %'
    then 'Teenage Mutant Ninja Turtles'
  when upper(btrim(nom)) = 'THE MASK'
    then 'The Mask'
  when upper(btrim(nom)) = any (array[
    'ANT-MAN', 'BEAST', 'BISHOP', 'BLACK PANTHER', 'BLACK WIDOW',
    'CABLE', 'CAPTAIN AMERICA', 'CAPTAIN MARVEL', 'COLOSSUS', 'CYCLOPE',
    'DAREDEVIL', 'DEADPOOL', 'DOCTOR STRANGE', 'DRAX', 'ECHO', 'FALCON',
    'GAMBIT', 'GAMORA', 'GROOT', 'HAWKEYE', 'HULK', 'ICEMAN', 'IRON MAN',
    'JEAN GREY', 'KATE BISHOP', 'KITTY PRYDE', 'LOKI', 'MAGNETO', 'MANTIS',
    'MISTER SINISTER', 'MOON KNIGHT', 'MS. MARVEL', 'MYSTIQUE', 'NIGHTCRAWLER',
    'PROFESSOR X', 'PSYLOCKE', 'PUNISHER', 'QUICKSILVER', 'ROCKET RACCOON',
    'ROGUE', 'SABRETOOTH', 'SCARLET WITCH', 'SHANG-CHI', 'SHE-HULK',
    'SPIDER-MAN', 'STAR-LORD', 'STORM', 'THANOS', 'THOR', 'VENOM', 'VISION',
    'WAR MACHINE', 'WASP', 'WINTER SOLDIER', 'WOLVERINE'
  ]) then 'Marvel'
  else franchise
end
where upper(btrim(categorie)) = 'COMICS'
  and nullif(btrim(franchise), '') is null;

commit;
