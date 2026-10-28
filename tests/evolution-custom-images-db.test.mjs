import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("SSR and LR evolution retain the selected owned custom art in storage and the immediate response", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const alice = "76100000-0000-4000-8000-000000000001";
  const bob = "76100000-0000-4000-8000-000000000002";
  for (const [id, pseudo] of [
    [alice, "ImageAlice"],
    [bob, "ImageBob"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  const original = "https://example.test/original.png";
  const artA = "https://i.imgur.com/custom-a.png";
  const artB = "https://i.imgur.com/custom-b.png";
  const outsideArt = "https://i.imgur.com/not-consumed.png";
  async function login(id = alice, role = "authenticated") {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id ?? ""
    ]);
    await db.exec("set role " + role);
  }
  for (const rarity of ["SSR", "LR"]) {
    await db.exec("reset role");
    const cardId = (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'ANIME/MANGA','Test',$2,$3,'test') returning id",
        [rarity, rarity, original]
      )
    ).rows[0].id;
    async function copies(art, owner = alice, locked = false) {
      await db.exec("reset role");
      const result = [];
      for (const image of art)
        result.push(
          (
            await db.query(
              "insert into public.user_cards(user_id,card_id,rarity,custom_image_url,is_locked) values($1,$2,$3,$4,$5) returning id",
              [owner, cardId, rarity, image, locked]
            )
          ).rows[0].id
        );
      return result;
    }
    const outside = (await copies([outsideArt]))[0];
    const foreign = (await copies([artB], bob))[0];
    const required = rarity === "LR" ? 3 : 5;
    for (const [images, preference, expected] of [
      [[null, artA, null, null, null], null, artA],
      [[null, artA, artB, null, null], 2, artB],
      [[null, null, null, null, null], null, null]
    ]) {
      const ids = await copies(images.slice(0, required));
      const ordered =
        preference === null
          ? ids
          : [
              ids[preference],
              ...ids.filter((_, index) => index !== preference)
            ];
      await login();
      const result = (
        await db.query(
          `select public.evolve_${rarity.toLowerCase()}_card($1::uuid[]) value`,
          [ordered]
        )
      ).rows[0].value;
      assert.equal(result.customImageUrl, expected);
      assert.equal(result.image, expected ?? original);
      assert.equal(result.catalogueImage, original);
      assert.equal(result.isEvolved, true);
      assert.equal(result.shiny, rarity === "SSR");
      assert.equal(result.folderId, null);
      await db.exec("reset role");
      const persisted = (
        await db.query(
          "select custom_image_url,is_evolved,is_shiny from public.user_cards where id=$1",
          [result.instanceId]
        )
      ).rows[0];
      assert.equal(
        persisted.custom_image_url,
        expected,
        "A collection reload retains the selected image"
      );
      assert.equal(persisted.is_evolved, true);
      assert.equal(persisted.is_shiny, rarity === "SSR");
      assert.equal(
        Number(
          (
            await db.query(
              "select count(*) n from public.user_cards where id=any($1::uuid[])",
              [ids]
            )
          ).rows[0].n
        ),
        0
      );
      assert.equal(
        (
          await db.query(
            "select custom_image_url from public.user_cards where id=$1",
            [outside]
          )
        ).rows[0].custom_image_url,
        outsideArt
      );
      assert.equal(
        (
          await db.query(
            "select custom_image_url from public.user_cards where id=$1",
            [foreign]
          )
        ).rows[0].custom_image_url,
        artB
      );
    }
    const valid = await copies(
      [artA, null, null, null, null].slice(0, required)
    );
    const locked = (await copies([artB], alice, true))[0];
    const snapshot = async () =>
      JSON.stringify(
        (
          await db.query(
            "select id,user_id,card_id,custom_image_url,is_locked,is_shiny,is_evolved from public.user_cards order by id"
          )
        ).rows
      );
    const before = await snapshot();
    await login();
    await assert.rejects(
      db.query(
        `select public.evolve_${rarity.toLowerCase()}_card($1::uuid[])`,
        [[foreign, ...valid.slice(1)]]
      ),
      rarity === "LR" ? /INVALID_LR_COPIES/ : /SSR_CARD_NOT_OWNED/
    );
    await assert.rejects(
      db.query(
        `select public.evolve_${rarity.toLowerCase()}_card($1::uuid[])`,
        [[locked, ...valid.slice(1)]]
      ),
      /CARD_LOCKED/
    );
    await login(null);
    await assert.rejects(
      db.query(
        `select public.evolve_${rarity.toLowerCase()}_card($1::uuid[])`,
        [valid]
      ),
      /AUTH_REQUIRED/
    );
    await login(alice, "anon");
    await assert.rejects(
      db.query(
        `select public.evolve_${rarity.toLowerCase()}_card($1::uuid[])`,
        [valid]
      ),
      /permission denied/
    );
    await db.exec("reset role");
    assert.equal(
      await snapshot(),
      before,
      "Rejected attempts preserve all copies and custom images"
    );
    await db.exec(
      `create function public.fail_${rarity.toLowerCase()}_image_evolution() returns trigger language plpgsql as $$begin if new.is_evolved and new.rarity='${rarity}' then raise exception 'TEST_IMAGE_INSERT_FAILURE';end if;return new;end$$; create trigger fail_image_${rarity.toLowerCase()} before insert on public.user_cards for each row execute function public.fail_${rarity.toLowerCase()}_image_evolution()`
    );
    await login();
    await assert.rejects(
      db.query(
        `select public.evolve_${rarity.toLowerCase()}_card($1::uuid[])`,
        [valid]
      ),
      /TEST_IMAGE_INSERT_FAILURE/
    );
    await db.exec("reset role");
    assert.equal(
      await snapshot(),
      before,
      "A result insertion failure restores consumed copies and their art"
    );
  }
});
