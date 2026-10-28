# PERF-09: reproducible PGlite profile

Reproduce: `node scripts/profile-achievements.mjs docs/audits/PERF-09-profile.md` (Node 22, locked dependencies). Baseline: origin/master 69daa2d2d9930083d3c336b2b50b46ae9d827d99. The script replays all migrations except the candidate, measures, then applies it to the same disposable database. No remote database is used.

EXPLAIN runs the actual completion function body and the four inner progress queries as the database owner (matching SECURITY DEFINER). Live progress queries deliberately retain their original plans and cost. Pending collection conditions still scan; completed conditions are removed before progress evaluation. No counters, indexes, API or player text changes. Migration: 20261018210000_pending_achievement_evaluation.sql — non appliquée sur le VPS.

The new regression test failed on master (completed collection conditions invoked achievement_progress). No existing test is modified. The before/after measurements below are one serial run; the earlier standalone baseline was 462.57 ms under different host load and is not used to calculate gains.
20,000 catalogue cards, five balanced rarities, one category; exactly 30,000 copies / 20,000 distinct cards. Real triggers enabled. Each authenticated RPC uses the same seed and is rolled back. One warm-up, eight samples per state. Timings cover only open_regular_pack, excluding snapshots and EXPLAIN. PGlite/Windows timings are not PostgreSQL 17 production latency.

## Before — Shiny achievement pending

Median: **159.22 ms**. Samples (ms): 156.81, 153.49, 165.79, 146.07, 159.28, 159.16, 185.50, 172.23.

### unique

```text
Aggregate  (cost=2672.29..2672.30 rows=1 width=8) (actual time=56.438..56.439 rows=1.00 loops=1)
  Buffers: shared hit=30111
  ->  Index Scan using user_cards_card_id_idx on user_cards  (cost=0.29..2597.29 rows=30000 width=16) (actual time=0.057..40.484 rows=30000.00 loops=1)
        Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
        Index Searches: 1
        Buffers: shared hit=30111
Planning Time: 0.155 ms
Execution Time: 56.577 ms
```

### lr

```text
Result  (cost=0.97..0.98 rows=1 width=1) (actual time=0.027..0.030 rows=1.00 loops=1)
  Buffers: shared hit=5
  InitPlan 1
    ->  Nested Loop  (cost=0.29..4067.00 rows=6000 width=0) (actual time=0.025..0.026 rows=1.00 loops=1)
          Buffers: shared hit=5
          ->  Seq Scan on cards c  (cost=0.00..605.00 rows=4000 width=16) (actual time=0.012..0.013 rows=1.00 loops=1)
                Filter: (rarete_base = 'LR'::card_rarity)
                Rows Removed by Filter: 4
                Buffers: shared hit=2
          ->  Index Scan using user_cards_card_id_idx on user_cards uc  (cost=0.29..0.85 rows=2 width=16) (actual time=0.009..0.010 rows=1.00 loops=1)
                Index Cond: (card_id = c.id)
                Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
                Index Searches: 1
                Buffers: shared hit=3
Planning:
  Buffers: shared hit=12
Planning Time: 0.366 ms
Execution Time: 0.056 ms
```

### shiny

```text
Aggregate  (cost=746.00..746.01 rows=1 width=8) (actual time=3.780..3.781 rows=1.00 loops=1)
  Buffers: shared hit=371
  ->  Seq Scan on user_cards  (cost=0.00..746.00 rows=1 width=0) (actual time=3.773..3.773 rows=0.00 loops=1)
        Filter: (is_shiny AND (user_id = '10000000-0000-4000-8000-000000000009'::uuid))
        Rows Removed by Filter: 30000
        Buffers: shared hit=371
Planning Time: 0.078 ms
Execution Time: 3.806 ms
```

### category

```text
Aggregate  (cost=4160.71..4160.72 rows=1 width=4) (actual time=183.256..183.262 rows=1.00 loops=1)
  Buffers: shared hit=726
  ->  GroupAggregate  (cost=3860.67..4160.69 rows=1 width=24) (actual time=183.240..183.245 rows=1.00 loops=1)
        Group Key: c.categorie
        Filter: (count(DISTINCT c.id) > 0)
        Buffers: shared hit=726
        ->  Sort  (cost=3860.67..3935.67 rows=30000 width=40) (actual time=142.395..157.008 rows=30000.00 loops=1)
              Sort Key: c.categorie, uc.card_id
              Sort Method: quicksort  Memory: 2153kB
              Buffers: shared hit=726
              ->  Hash Right Join  (cost=805.00..1629.77 rows=30000 width=40) (actual time=19.460..64.299 rows=30000.00 loops=1)
                    Hash Cond: (uc.card_id = c.id)
                    Buffers: shared hit=726
                    ->  Seq Scan on user_cards uc  (cost=0.00..746.00 rows=30000 width=16) (actual time=0.029..16.728 rows=30000.00 loops=1)
                          Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
                          Buffers: shared hit=371
                    ->  Hash  (cost=555.00..555.00 rows=20000 width=24) (actual time=19.415..19.416 rows=20000.00 loops=1)
                          Buckets: 32768  Batches: 1  Memory Usage: 1066kB
                          Buffers: shared hit=355
                          ->  Seq Scan on cards c  (cost=0.00..555.00 rows=20000 width=24) (actual time=0.012..9.279 rows=20000.00 loops=1)
                                Buffers: shared hit=355
Planning:
  Buffers: shared hit=12
Planning Time: 0.381 ms
Execution Time: 183.318 ms
```

### complete_achievements

```text
Insert on notifications  (cost=3.95..3.97 rows=0 width=0) (actual time=133.404..133.407 rows=0.00 loops=1)
  Conflict Resolution: NOTHING
  Tuples Inserted: 0
  Conflicting Tuples: 0
  Buffers: shared hit=31237
  CTE completed
    ->  Insert on user_achievements  (cost=0.00..3.95 rows=1 width=47) (actual time=133.255..133.257 rows=0.00 loops=1)
          Conflict Resolution: UPDATE
          Conflict Arbiter Indexes: user_achievements_pkey
          Conflict Filter: (user_achievements.completed_at IS NULL)
          Rows Removed by Conflict Filter: 3
          Tuples Inserted: 0
          Conflicting Tuples: 3
          Buffers: shared hit=31237
          ->  Subquery Scan on "*SELECT*"  (cost=0.00..3.95 rows=1 width=47) (actual time=26.801..132.959 rows=3.00 loops=1)
                Buffers: shared hit=31228
                ->  Seq Scan on achievements a  (cost=0.00..3.95 rows=1 width=39) (actual time=26.796..132.947 rows=3.00 loops=1)
                      Filter: ((condition_type = ANY ('{unique_cards_collected,first_lr_card,shiny_cards_collected,cards_collected_category_percent}'::text[])) AND (achievement_progress('10000000-0000-4000-8000-000000000009'::uuid, condition_type) >= condition_value))
                      Rows Removed by Filter: 8
                      Buffers: shared hit=31228
  ->  CTE Scan on completed  (cost=0.00..0.03 rows=1 width=144) (actual time=133.257..133.258 rows=0.00 loops=1)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=31237
Planning Time: 0.173 ms
Trigger account_deletion_reference_guard on user_achievements: time=0.129 calls=3
Trigger account_deletion_write_guard on user_achievements: time=0.044 calls=2
Trigger account_deletion_write_guard on notifications: time=0.140 calls=1
Execution Time: 133.450 ms
```

## After — Shiny achievement pending

Median: **24.18 ms**. Samples (ms): 31.52, 29.12, 26.79, 21.53, 19.53, 22.63, 20.05, 25.72.

### unique

```text
Aggregate  (cost=2677.91..2677.92 rows=1 width=8) (actual time=106.765..106.767 rows=1.00 loops=1)
  Buffers: shared hit=30111
  ->  Index Scan using user_cards_card_id_idx on user_cards  (cost=0.29..2602.70 rows=30081 width=16) (actual time=0.021..78.957 rows=30000.00 loops=1)
        Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
        Index Searches: 1
        Buffers: shared hit=30111
Planning Time: 0.194 ms
Execution Time: 106.809 ms
```

### lr

```text
Result  (cost=0.96..0.97 rows=1 width=1) (actual time=0.032..0.035 rows=1.00 loops=1)
  Buffers: shared hit=5
  InitPlan 1
    ->  Nested Loop  (cost=0.29..4071.00 rows=6016 width=0) (actual time=0.029..0.031 rows=1.00 loops=1)
          Buffers: shared hit=5
          ->  Seq Scan on cards c  (cost=0.00..605.00 rows=4000 width=16) (actual time=0.015..0.015 rows=1.00 loops=1)
                Filter: (rarete_base = 'LR'::card_rarity)
                Rows Removed by Filter: 4
                Buffers: shared hit=2
          ->  Index Scan using user_cards_card_id_idx on user_cards uc  (cost=0.29..0.85 rows=2 width=16) (actual time=0.011..0.011 rows=1.00 loops=1)
                Index Cond: (card_id = c.id)
                Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
                Index Searches: 1
                Buffers: shared hit=3
Planning:
  Buffers: shared hit=12
Planning Time: 0.448 ms
Execution Time: 0.064 ms
```

### shiny

```text
Aggregate  (cost=748.02..748.03 rows=1 width=8) (actual time=5.061..5.062 rows=1.00 loops=1)
  Buffers: shared hit=372
  ->  Seq Scan on user_cards  (cost=0.00..748.01 rows=1 width=0) (actual time=5.048..5.049 rows=0.00 loops=1)
        Filter: (is_shiny AND (user_id = '10000000-0000-4000-8000-000000000009'::uuid))
        Rows Removed by Filter: 30000
        Buffers: shared hit=372
Planning Time: 0.090 ms
Execution Time: 5.090 ms
```

### category

```text
Aggregate  (cost=4170.36..4170.37 rows=1 width=4) (actual time=201.981..201.992 rows=1.00 loops=1)
  Buffers: shared hit=727
  ->  GroupAggregate  (cost=3869.51..4170.33 rows=1 width=24) (actual time=201.954..201.964 rows=1.00 loops=1)
        Group Key: c.categorie
        Filter: (count(DISTINCT c.id) > 0)
        Buffers: shared hit=727
        ->  Sort  (cost=3869.51..3944.71 rows=30081 width=40) (actual time=162.677..175.839 rows=30000.00 loops=1)
              Sort Key: c.categorie, uc.card_id
              Sort Method: quicksort  Memory: 2153kB
              Buffers: shared hit=727
              ->  Hash Right Join  (cost=805.00..1632.00 rows=30081 width=40) (actual time=25.388..80.575 rows=30000.00 loops=1)
                    Hash Cond: (uc.card_id = c.id)
                    Buffers: shared hit=727
                    ->  Seq Scan on user_cards uc  (cost=0.00..748.01 rows=30081 width=16) (actual time=0.029..20.369 rows=30000.00 loops=1)
                          Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
                          Buffers: shared hit=372
                    ->  Hash  (cost=555.00..555.00 rows=20000 width=24) (actual time=25.303..25.305 rows=20000.00 loops=1)
                          Buckets: 32768  Batches: 1  Memory Usage: 1066kB
                          Buffers: shared hit=355
                          ->  Seq Scan on cards c  (cost=0.00..555.00 rows=20000 width=24) (actual time=0.028..11.445 rows=20000.00 loops=1)
                                Buffers: shared hit=355
Planning:
  Buffers: shared hit=12
Planning Time: 0.768 ms
Execution Time: 202.097 ms
```

### complete_achievements

```text
Insert on notifications  (cost=3.10..3.13 rows=0 width=0) (actual time=7.695..7.705 rows=0.00 loops=1)
  Conflict Resolution: NOTHING
  Tuples Inserted: 0
  Conflicting Tuples: 0
  Buffers: shared hit=374
  CTE pending
    ->  Hash Anti Join  (cost=1.08..2.28 rows=3 width=39) (actual time=0.053..0.079 rows=1.00 loops=1)
          Hash Cond: (a.id = ua.achievement_id)
          Buffers: shared hit=2
          ->  Seq Scan on achievements a  (cost=0.00..1.17 rows=4 width=39) (actual time=0.020..0.033 rows=4.00 loops=1)
                Filter: (condition_type = ANY ('{unique_cards_collected,first_lr_card,shiny_cards_collected,cards_collected_category_percent}'::text[]))
                Rows Removed by Filter: 7
                Buffers: shared hit=1
          ->  Hash  (cost=1.04..1.04 rows=3 width=17) (actual time=0.019..0.022 rows=3.00 loops=1)
                Buckets: 1024  Batches: 1  Memory Usage: 5kB
                Buffers: shared hit=1
                ->  Seq Scan on user_achievements ua  (cost=0.00..1.04 rows=3 width=17) (actual time=0.008..0.012 rows=3.00 loops=1)
                      Filter: ((completed_at IS NOT NULL) AND (user_id = '10000000-0000-4000-8000-000000000009'::uuid))
                      Buffers: shared hit=1
  CTE completed
    ->  Insert on user_achievements  (cost=0.00..0.82 rows=1 width=64) (actual time=7.582..7.585 rows=0.00 loops=1)
          Conflict Resolution: UPDATE
          Conflict Arbiter Indexes: user_achievements_pkey
          Conflict Filter: (user_achievements.completed_at IS NULL)
          Tuples Inserted: 0
          Conflicting Tuples: 0
          Buffers: shared hit=374
          ->  Subquery Scan on "*SELECT*"  (cost=0.00..0.82 rows=1 width=64) (actual time=7.519..7.520 rows=0.00 loops=1)
                Buffers: shared hit=374
                ->  CTE Scan on pending a_1  (cost=0.00..0.82 rows=1 width=56) (actual time=7.516..7.517 rows=0.00 loops=1)
                      Filter: (achievement_progress('10000000-0000-4000-8000-000000000009'::uuid, condition_type) >= condition_value)
                      Rows Removed by Filter: 1
                      Storage: Memory  Maximum Storage: 17kB
                      Buffers: shared hit=374
  ->  CTE Scan on completed  (cost=0.00..0.03 rows=1 width=144) (actual time=7.585..7.586 rows=0.00 loops=1)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=374
Planning:
  Buffers: shared hit=2
Planning Time: 0.480 ms
Trigger account_deletion_write_guard on user_achievements: time=0.050 calls=2
Trigger account_deletion_write_guard on notifications: time=0.101 calls=1
Execution Time: 7.792 ms
```

## Before — all collection achievements completed

Median: **157.40 ms**. Samples (ms): 168.57, 153.94, 163.11, 171.07, 154.53, 144.50, 160.27, 139.23.

### unique

```text
Aggregate  (cost=2683.53..2683.54 rows=1 width=8) (actual time=55.500..55.501 rows=1.00 loops=1)
  Buffers: shared hit=30113
  ->  Index Scan using user_cards_card_id_idx on user_cards  (cost=0.29..2608.12 rows=30162 width=16) (actual time=0.016..40.511 rows=30000.00 loops=1)
        Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
        Index Searches: 1
        Buffers: shared hit=30113
Planning Time: 0.107 ms
Execution Time: 55.531 ms
```

### lr

```text
Result  (cost=0.96..0.97 rows=1 width=1) (actual time=0.034..0.037 rows=1.00 loops=1)
  Buffers: shared hit=6
  InitPlan 1
    ->  Nested Loop  (cost=0.29..4075.00 rows=6032 width=0) (actual time=0.032..0.033 rows=1.00 loops=1)
          Buffers: shared hit=6
          ->  Seq Scan on cards c  (cost=0.00..605.00 rows=4000 width=16) (actual time=0.016..0.016 rows=1.00 loops=1)
                Filter: (rarete_base = 'LR'::card_rarity)
                Rows Removed by Filter: 4
                Buffers: shared hit=2
          ->  Index Scan using user_cards_card_id_idx on user_cards uc  (cost=0.29..0.85 rows=2 width=16) (actual time=0.013..0.013 rows=1.00 loops=1)
                Index Cond: (card_id = c.id)
                Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
                Index Searches: 1
                Buffers: shared hit=4
Planning:
  Buffers: shared hit=12
Planning Time: 0.450 ms
Execution Time: 0.070 ms
```

### shiny

```text
Aggregate  (cost=750.03..750.04 rows=1 width=8) (actual time=3.760..3.762 rows=1.00 loops=1)
  Buffers: shared hit=373
  ->  Seq Scan on user_cards  (cost=0.00..750.03 rows=1 width=0) (actual time=3.739..3.742 rows=1.00 loops=1)
        Filter: (is_shiny AND (user_id = '10000000-0000-4000-8000-000000000009'::uuid))
        Rows Removed by Filter: 29999
        Buffers: shared hit=373
Planning Time: 0.098 ms
Execution Time: 3.789 ms
```

### category

```text
Aggregate  (cost=4180.00..4180.01 rows=1 width=4) (actual time=228.500..228.510 rows=1.00 loops=1)
  Buffers: shared hit=728
  ->  GroupAggregate  (cost=3878.34..4179.97 rows=1 width=24) (actual time=228.475..228.484 rows=1.00 loops=1)
        Group Key: c.categorie
        Filter: (count(DISTINCT c.id) > 0)
        Buffers: shared hit=728
        ->  Sort  (cost=3878.34..3953.75 rows=30162 width=40) (actual time=180.939..196.504 rows=30000.00 loops=1)
              Sort Key: c.categorie, uc.card_id
              Sort Method: quicksort  Memory: 2153kB
              Buffers: shared hit=728
              ->  Hash Right Join  (cost=805.00..1634.22 rows=30162 width=40) (actual time=23.125..89.330 rows=30000.00 loops=1)
                    Hash Cond: (uc.card_id = c.id)
                    Buffers: shared hit=728
                    ->  Seq Scan on user_cards uc  (cost=0.00..750.03 rows=30162 width=16) (actual time=0.027..24.291 rows=30000.00 loops=1)
                          Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
                          Buffers: shared hit=373
                    ->  Hash  (cost=555.00..555.00 rows=20000 width=24) (actual time=23.082..23.084 rows=20000.00 loops=1)
                          Buckets: 32768  Batches: 1  Memory Usage: 1066kB
                          Buffers: shared hit=355
                          ->  Seq Scan on cards c  (cost=0.00..555.00 rows=20000 width=24) (actual time=0.012..10.671 rows=20000.00 loops=1)
                                Buffers: shared hit=355
Planning:
  Buffers: shared hit=12
Planning Time: 0.407 ms
Execution Time: 228.577 ms
```

### complete_achievements

```text
Insert on notifications  (cost=3.95..3.97 rows=0 width=0) (actual time=165.235..165.240 rows=0.00 loops=1)
  Conflict Resolution: NOTHING
  Tuples Inserted: 0
  Conflicting Tuples: 0
  Buffers: shared hit=31248
  CTE completed
    ->  Insert on user_achievements  (cost=0.00..3.95 rows=1 width=47) (actual time=165.112..165.116 rows=0.00 loops=1)
          Conflict Resolution: UPDATE
          Conflict Arbiter Indexes: user_achievements_pkey
          Conflict Filter: (user_achievements.completed_at IS NULL)
          Rows Removed by Conflict Filter: 4
          Tuples Inserted: 0
          Conflicting Tuples: 4
          Buffers: shared hit=31248
          ->  Subquery Scan on "*SELECT*"  (cost=0.00..3.95 rows=1 width=47) (actual time=32.346..164.670 rows=4.00 loops=1)
                Buffers: shared hit=31236
                ->  Seq Scan on achievements a  (cost=0.00..3.95 rows=1 width=39) (actual time=32.341..164.649 rows=4.00 loops=1)
                      Filter: ((condition_type = ANY ('{unique_cards_collected,first_lr_card,shiny_cards_collected,cards_collected_category_percent}'::text[])) AND (achievement_progress('10000000-0000-4000-8000-000000000009'::uuid, condition_type) >= condition_value))
                      Rows Removed by Filter: 7
                      Buffers: shared hit=31236
  ->  CTE Scan on completed  (cost=0.00..0.03 rows=1 width=144) (actual time=165.115..165.116 rows=0.00 loops=1)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=31248
Planning Time: 0.671 ms
Trigger account_deletion_reference_guard on user_achievements: time=0.200 calls=4
Trigger account_deletion_write_guard on user_achievements: time=0.060 calls=2
Trigger account_deletion_write_guard on notifications: time=0.109 calls=1
Execution Time: 165.306 ms
```

## After — all collection achievements completed

Median: **40.96 ms**. Samples (ms): 56.07, 44.10, 46.46, 53.09, 37.83, 30.99, 20.08, 20.48.

### unique

```text
Aggregate  (cost=2683.53..2683.54 rows=1 width=8) (actual time=52.250..52.252 rows=1.00 loops=1)
  Buffers: shared hit=30113
  ->  Index Scan using user_cards_card_id_idx on user_cards  (cost=0.29..2608.12 rows=30162 width=16) (actual time=0.014..38.468 rows=30000.00 loops=1)
        Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
        Index Searches: 1
        Buffers: shared hit=30113
Planning Time: 0.095 ms
Execution Time: 52.280 ms
```

### lr

```text
Result  (cost=0.96..0.97 rows=1 width=1) (actual time=0.029..0.031 rows=1.00 loops=1)
  Buffers: shared hit=6
  InitPlan 1
    ->  Nested Loop  (cost=0.29..4075.00 rows=6032 width=0) (actual time=0.026..0.028 rows=1.00 loops=1)
          Buffers: shared hit=6
          ->  Seq Scan on cards c  (cost=0.00..605.00 rows=4000 width=16) (actual time=0.013..0.013 rows=1.00 loops=1)
                Filter: (rarete_base = 'LR'::card_rarity)
                Rows Removed by Filter: 4
                Buffers: shared hit=2
          ->  Index Scan using user_cards_card_id_idx on user_cards uc  (cost=0.29..0.85 rows=2 width=16) (actual time=0.011..0.011 rows=1.00 loops=1)
                Index Cond: (card_id = c.id)
                Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
                Index Searches: 1
                Buffers: shared hit=4
Planning:
  Buffers: shared hit=12
Planning Time: 0.381 ms
Execution Time: 0.061 ms
```

### shiny

```text
Aggregate  (cost=750.03..750.04 rows=1 width=8) (actual time=3.864..3.866 rows=1.00 loops=1)
  Buffers: shared hit=373
  ->  Seq Scan on user_cards  (cost=0.00..750.03 rows=1 width=0) (actual time=3.851..3.854 rows=1.00 loops=1)
        Filter: (is_shiny AND (user_id = '10000000-0000-4000-8000-000000000009'::uuid))
        Rows Removed by Filter: 29999
        Buffers: shared hit=373
Planning Time: 0.076 ms
Execution Time: 3.891 ms
```

### category

```text
Aggregate  (cost=4180.00..4180.01 rows=1 width=4) (actual time=194.312..194.319 rows=1.00 loops=1)
  Buffers: shared hit=728
  ->  GroupAggregate  (cost=3878.34..4179.97 rows=1 width=24) (actual time=194.298..194.303 rows=1.00 loops=1)
        Group Key: c.categorie
        Filter: (count(DISTINCT c.id) > 0)
        Buffers: shared hit=728
        ->  Sort  (cost=3878.34..3953.75 rows=30162 width=40) (actual time=151.910..166.786 rows=30000.00 loops=1)
              Sort Key: c.categorie, uc.card_id
              Sort Method: quicksort  Memory: 2153kB
              Buffers: shared hit=728
              ->  Hash Right Join  (cost=805.00..1634.22 rows=30162 width=40) (actual time=22.491..70.627 rows=30000.00 loops=1)
                    Hash Cond: (uc.card_id = c.id)
                    Buffers: shared hit=728
                    ->  Seq Scan on user_cards uc  (cost=0.00..750.03 rows=30162 width=16) (actual time=0.020..17.408 rows=30000.00 loops=1)
                          Filter: (user_id = '10000000-0000-4000-8000-000000000009'::uuid)
                          Buffers: shared hit=373
                    ->  Hash  (cost=555.00..555.00 rows=20000 width=24) (actual time=22.457..22.458 rows=20000.00 loops=1)
                          Buckets: 32768  Batches: 1  Memory Usage: 1066kB
                          Buffers: shared hit=355
                          ->  Seq Scan on cards c  (cost=0.00..555.00 rows=20000 width=24) (actual time=0.013..10.406 rows=20000.00 loops=1)
                                Buffers: shared hit=355
Planning:
  Buffers: shared hit=12
Planning Time: 0.396 ms
Execution Time: 194.377 ms
```

### complete_achievements

```text
Insert on notifications  (cost=3.10..3.13 rows=0 width=0) (actual time=0.148..0.152 rows=0.00 loops=1)
  Conflict Resolution: NOTHING
  Tuples Inserted: 0
  Conflicting Tuples: 0
  Buffers: shared hit=2
  CTE pending
    ->  Hash Anti Join  (cost=1.08..2.28 rows=3 width=39) (actual time=0.040..0.042 rows=0.00 loops=1)
          Hash Cond: (a.id = ua.achievement_id)
          Buffers: shared hit=2
          ->  Seq Scan on achievements a  (cost=0.00..1.17 rows=4 width=39) (actual time=0.013..0.017 rows=4.00 loops=1)
                Filter: (condition_type = ANY ('{unique_cards_collected,first_lr_card,shiny_cards_collected,cards_collected_category_percent}'::text[]))
                Rows Removed by Filter: 7
                Buffers: shared hit=1
          ->  Hash  (cost=1.04..1.04 rows=3 width=17) (actual time=0.015..0.016 rows=4.00 loops=1)
                Buckets: 1024  Batches: 1  Memory Usage: 5kB
                Buffers: shared hit=1
                ->  Seq Scan on user_achievements ua  (cost=0.00..1.04 rows=3 width=17) (actual time=0.006..0.008 rows=4.00 loops=1)
                      Filter: ((completed_at IS NOT NULL) AND (user_id = '10000000-0000-4000-8000-000000000009'::uuid))
                      Buffers: shared hit=1
  CTE completed
    ->  Insert on user_achievements  (cost=0.00..0.82 rows=1 width=64) (actual time=0.081..0.082 rows=0.00 loops=1)
          Conflict Resolution: UPDATE
          Conflict Arbiter Indexes: user_achievements_pkey
          Conflict Filter: (user_achievements.completed_at IS NULL)
          Tuples Inserted: 0
          Conflicting Tuples: 0
          Buffers: shared hit=2
          ->  Subquery Scan on "*SELECT*"  (cost=0.00..0.82 rows=1 width=64) (actual time=0.042..0.043 rows=0.00 loops=1)
                Buffers: shared hit=2
                ->  CTE Scan on pending a_1  (cost=0.00..0.82 rows=1 width=56) (actual time=0.041..0.041 rows=0.00 loops=1)
                      Filter: (achievement_progress('10000000-0000-4000-8000-000000000009'::uuid, condition_type) >= condition_value)
                      Storage: Memory  Maximum Storage: 17kB
                      Buffers: shared hit=2
  ->  CTE Scan on completed  (cost=0.00..0.03 rows=1 width=144) (actual time=0.083..0.083 rows=0.00 loops=1)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=2
Planning:
  Buffers: shared hit=2
Planning Time: 0.326 ms
Trigger account_deletion_write_guard on user_achievements: time=0.033 calls=2
Trigger account_deletion_write_guard on notifications: time=0.060 calls=1
Execution Time: 0.203 ms
```

Before/after pack contents, live progress, completed/claimed states, notifications and counters: identical.
