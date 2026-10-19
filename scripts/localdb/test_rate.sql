set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select rate_wine((select id from wines where slug like 'kosta-browne%' limit 1), 5, 'gorgeous', array['raspberry','cola'], array[]::text[]);
select rate_wine((select id from wines where producer ilike '%rombauer%' limit 1), 1.5, 'too much butter', array[]::text[], array['butter','vanilla']);
select rating_count from palates;
select jsonb_pretty(my_palate_summary() - 'structure') ;
select name, match, reasons, cautions from recommend_wines(6);
select wine_match((select id from wines where producer ilike '%rombauer%' limit 1));
