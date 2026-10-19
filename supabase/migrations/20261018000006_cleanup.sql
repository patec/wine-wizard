-- One-time cleanup for the hosted project, whose history briefly had a FOR ALL policy on wine_attributes
-- (now neutralised to USING false). Safe to run anywhere.
drop policy if exists "authors add own wine attributes" on public.wine_attributes;
drop policy if exists "authors profile own wines" on public.wine_attributes;
