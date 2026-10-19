insert into auth.users(id,email,raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111','t@x.com','{"display_name":"Pate"}');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select display_name from palates;
select save_palate_quiz('{"styles":{"red":1,"white":0.5,"rose":0,"sparkling":0.5,"orange":-0.5,"dessert":-0.5,"fortified":-1},
 "families":{"black_fruit":1,"earth":1,"tertiary":0.5,"mineral":0.5,"tropical_fruit":-1,"oak":-0.5,"roast_confection":-0.5},
 "notes_love":["graphite","violet","black_pepper"],"notes_avoid":["butter","coconut"],
 "structure":{"sweetness":0.05,"acidity":0.7,"tannin":0.65,"body":0.65,"oak_influence":0.3,"maturity":0.5},
 "budget_max":80}'::jsonb);
select rating_count, struct_target[1:6], struct_mask[1:6], style_affinity from palates;
select name, producer, wine_type, price_usd, match, flavor_match, structure_match, style_match, reasons, cautions from recommend_wines(12);
