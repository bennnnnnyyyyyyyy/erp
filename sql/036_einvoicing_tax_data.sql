-- 036_einvoicing_tax_data.sql
-- Slice A1 of the Egypt e-invoicing module (documentation/plans/ETA_EINVOICING_PLAN.md sections 5 and 9): the tax master data an
-- ETA document needs, with no ETA connection yet. Company tax registration and ETA mode (simulated by default), branches, a per-company tax rate
-- table, ETA code tables (tax subtypes and unit codes: reference data published by ETA, the same for every company), customer
-- tax identity and address, and item codes (GS1 or EGS), unit code and default tax rate on items.
-- Nothing here is hardcoded to a customer: rates, branches and codes are the company's own rows. The module is OFF until an
-- organization switches on module key 'einvoicing' (it is not part of core_enable_all_modules).
-- Every new table has org_id and row level security, select-only for signed-in members; all changes go through the functions
-- below, which check role and module, then change the data and write the audit log in the same transaction (ADR-0003).
-- Depends on sql/001-034. Rerun-safe. Run the whole file, then sql/tests/030_einvoicing_tax_data.sql.

begin;

-- ---------------------------------------------------------------- ETA code tables (reference data, not business data)

create table if not exists public.eta_tax_subtypes (
  tax_type    text not null check (tax_type ~ '^T([1-9]|1[0-9]|20)$'),
  sub_type    text not null,
  description text not null,
  primary key (tax_type, sub_type)
);

create table if not exists public.eta_unit_types (
  code        text primary key,
  description text not null
);

alter table public.eta_tax_subtypes enable row level security;
alter table public.eta_unit_types enable row level security;
revoke all on public.eta_tax_subtypes, public.eta_unit_types from anon, authenticated;
grant select on public.eta_tax_subtypes, public.eta_unit_types to authenticated;
drop policy if exists eta_tax_subtypes_read on public.eta_tax_subtypes;
create policy eta_tax_subtypes_read on public.eta_tax_subtypes for select to authenticated using (true);
drop policy if exists eta_unit_types_read on public.eta_unit_types;
create policy eta_unit_types_read on public.eta_unit_types for select to authenticated using (true);

-- Source: SDK TaxSubtypes.json and UnitTypes.json (documentation/reference/eta-sdk/2026-11-02/files/files/), read 2 Nov 2026.
insert into public.eta_tax_subtypes (tax_type, sub_type, description) values
  ('T1', 'V001', 'Export'), ('T1', 'V002', 'Export to free areas and other areas'), ('T1', 'V003', 'Exempted good or service'),
  ('T1', 'V004', 'A non-taxable good or service'), ('T1', 'V005', 'Exemptions for diplomats, consulates and embassies'),
  ('T1', 'V006', 'Defence and national security exemptions'), ('T1', 'V007', 'Agreements exemptions'),
  ('T1', 'V008', 'Special exemptions and other reasons'), ('T1', 'V009', 'General item sales'), ('T1', 'V010', 'Other rates'),
  ('T2', 'Tbl01', 'Table tax (percentage)'), ('T3', 'Tbl02', 'Table tax (fixed amount)'),
  ('T4', 'W001', 'Contracting'), ('T4', 'W002', 'Supplies'), ('T4', 'W003', 'Purchases'), ('T4', 'W004', 'Services'),
  ('T4', 'W005', 'Sums paid by the cooperative societies for car transportation to their members'),
  ('T4', 'W006', 'Commission agency and brokerage'),
  ('T4', 'W007', 'Discounts, grants and additional exceptional incentives granted by smoke and cement companies'),
  ('T4', 'W008', 'All discounts, grants and commissions granted by petroleum, telecommunications and other companies'),
  ('T4', 'W009', 'Supporting export subsidies'), ('T4', 'W010', 'Professional fees'), ('T4', 'W011', 'Commission and brokerage (A/57)'),
  ('T4', 'W012', 'Hospitals collecting from doctors'), ('T4', 'W013', 'Royalties'), ('T4', 'W014', 'Customs clearance'),
  ('T4', 'W015', 'Exemption'), ('T4', 'W016', 'Advance payments'),
  ('T5', 'ST01', 'Stamping tax (percentage)'), ('T6', 'ST02', 'Stamping tax (amount)'),
  ('T7', 'Ent01', 'Entertainment tax (rate)'), ('T7', 'Ent02', 'Entertainment tax (amount)'),
  ('T8', 'RD01', 'Resource development fee (rate)'), ('T8', 'RD02', 'Resource development fee (amount)'),
  ('T9', 'SC01', 'Service charges (rate)'), ('T9', 'SC02', 'Service charges (amount)'),
  ('T10', 'Mn01', 'Municipality fees (rate)'), ('T10', 'Mn02', 'Municipality fees (amount)'),
  ('T11', 'MI01', 'Medical insurance fee (rate)'), ('T11', 'MI02', 'Medical insurance fee (amount)'),
  ('T12', 'OF01', 'Other fees (rate)'), ('T12', 'OF02', 'Other fees (amount)'),
  ('T13', 'ST03', 'Stamping tax (percentage), non-taxable'), ('T14', 'ST04', 'Stamping tax (amount), non-taxable'),
  ('T15', 'Ent03', 'Entertainment tax (rate), non-taxable'), ('T15', 'Ent04', 'Entertainment tax (amount), non-taxable'),
  ('T16', 'RD03', 'Resource development fee (rate), non-taxable'), ('T16', 'RD04', 'Resource development fee (amount), non-taxable'),
  ('T17', 'SC03', 'Service charges (rate), non-taxable'), ('T17', 'SC04', 'Service charges (amount), non-taxable'),
  ('T18', 'Mn03', 'Municipality fees (rate), non-taxable'), ('T18', 'Mn04', 'Municipality fees (amount), non-taxable'),
  ('T19', 'MI03', 'Medical insurance fee (rate), non-taxable'), ('T19', 'MI04', 'Medical insurance fee (amount), non-taxable'),
  ('T20', 'OF03', 'Other fees (rate), non-taxable'), ('T20', 'OF04', 'Other fees (amount), non-taxable')
on conflict (tax_type, sub_type) do nothing;

-- The SDK list names the code ST twice (Ton short, and Sheet); the first meaning is kept and the clash is noted in the plan.
insert into public.eta_unit_types (code, description) values
  ('2Z', 'Millivolt ( mV )'),
  ('4K', 'Milliampere ( mA )'),
  ('4O', 'Microfarad ( microF )'),
  ('5I', 'Standard cubic foot'),
  ('A87', 'Gigaohm ( GOhm )'),
  ('A93', 'Gram/Cubic meter ( g/m3 )'),
  ('A94', 'Gram/cubic centimeter ( g/cm3 )'),
  ('AE', 'Ampere per metre'),
  ('AMP', 'Ampere ( A )'),
  ('ANN', 'Years ( yr )'),
  ('B22', 'Kiloampere ( kA )'),
  ('B4', 'Barrel, Imperial'),
  ('B49', 'Kiloohm ( kOhm )'),
  ('B75', 'Megohm ( MOhm )'),
  ('B78', 'Megavolt ( MV )'),
  ('B84', 'Microampere ( microA )'),
  ('BAR', 'bar ( bar )'),
  ('BB', 'Base box'),
  ('BBL', 'Barrel (oil 42 gal.)'),
  ('BD', 'Board'),
  ('BE', 'Bundle'),
  ('BG', 'Bag ( Bag )'),
  ('BK', 'Basket'),
  ('BL', 'Bale'),
  ('BO', 'Bottle ( Bt. )'),
  ('BOX', 'Box'),
  ('C10', 'Millifarad ( mF )'),
  ('C39', 'Nanoampere ( nA )'),
  ('C41', 'Nanofarad ( nF )'),
  ('C45', 'Nanometer ( nm )'),
  ('C62', 'Activity unit ( AU )'),
  ('CA', 'Canister ( Can )'),
  ('CH', 'Container'),
  ('CMK', 'Square centimeter ( cm2 )'),
  ('CMQ', 'Cubic centimeter ( cm3 )'),
  ('CMT', 'Centimeter ( cm )'),
  ('CR', 'Crate'),
  ('CS', 'Case ( Case )'),
  ('CT', 'Carton ( Car )'),
  ('CTL', 'Centiliter ( Cl )'),
  ('D10', 'Siemens per meter ( S/m )'),
  ('D33', 'Tesla ( D )'),
  ('D41', 'Ton/Cubic meter ( t/m3 )'),
  ('DAA', 'Decare'),
  ('DAY', 'Days ( d )'),
  ('DMT', 'Decimeter ( dm )'),
  ('DRM', 'DRUM'),
  ('DTN', 'Decitonne'),
  ('DZN', 'Dozen'),
  ('EA', 'each (ST) ( ST )'),
  ('FAR', 'Farad ( F )'),
  ('FOT', 'Foot ( Foot )'),
  ('FP', 'Pound per square foot'),
  ('FTK', 'Square foot ( ft2 )'),
  ('FTQ', 'Cubic foot ( ft3 )'),
  ('G42', 'Microsiemens per centimeter ( microS/cm )'),
  ('GL', 'Gram/liter ( g/l )'),
  ('GLL', 'gallon ( gal )'),
  ('GM', 'Gram/square meter ( g/m2 )'),
  ('GPT', 'Gallon per thousand'),
  ('GRM', 'Gram ( g )'),
  ('H63', 'Milligram/Square centimeter ( mg/cm2 )'),
  ('HHP', 'Hydraulic Horse Power'),
  ('HLT', 'Hectoliter ( hl )'),
  ('HMT', 'Hectometre'),
  ('HTZ', 'Hertz (1/second) ( Hz )'),
  ('HUR', 'Hours ( hrs )'),
  ('IE', 'Number of Persons ( PRS )'),
  ('INH', 'Inch ( “” )'),
  ('INK', 'Square inch ( Inch2 )'),
  ('INQ', 'Cubic inch'),
  ('JOB', 'JOB'),
  ('KG', 'Keg'),
  ('KGM', 'Kilogram ( KG )'),
  ('KHZ', 'Kilohertz ( kHz )'),
  ('KMH', 'Kilometer/hour ( km/h )'),
  ('KMK', 'Square kilometer ( km2 )'),
  ('KMQ', 'Kilogram/cubic meter ( kg/m3 )'),
  ('KMT', 'Kilometer ( km )'),
  ('KSM', 'Kilogram/Square meter ( kg/m2 )'),
  ('KTM', 'Kilometre'),
  ('KVT', 'Kilovolt ( kV )'),
  ('KWT', 'Kilowatt ( KW )'),
  ('LB', 'pounds '),
  ('LO', 'Lot [unit of procurement]'),
  ('LTR', 'Liter ( l )'),
  ('LVL', 'Level'),
  ('M', 'Meter ( m )'),
  ('MAN', 'Man'),
  ('MAW', 'Megawatt ( VA )'),
  ('MGM', 'Milligram ( mg )'),
  ('MHZ', 'Megahertz ( MHz )'),
  ('MIN', 'Minute ( min )'),
  ('MLT', 'Millilitre'),
  ('MMK', 'Square millimeter ( mm2 )'),
  ('MMQ', 'Cubic millimeter ( mm3 )'),
  ('MMT', 'Millimeter ( mm )'),
  ('MON', 'Months ( Months )'),
  ('MT', 'Mat'),
  ('MTK', 'Square meter ( m2 )'),
  ('MTQ', 'Cubic meter ( m3 )'),
  ('NA', 'Milligram per kilogram'),
  ('NAR', 'Number of articles'),
  ('NC', 'Car'),
  ('NE', 'Net litre'),
  ('NMP', 'Number of packs'),
  ('NPL', 'Number of parcels'),
  ('NV', 'Vehicle'),
  ('OHM', 'Ohm ( Ohm )'),
  ('ONZ', 'Ounce ( oz )'),
  ('PA', 'Packet'),
  ('PAL', 'Pascal ( Pa )'),
  ('PF', 'Pallet ( PAL )'),
  ('PG', 'Plate'),
  ('PK', 'Pack ( PAK )'),
  ('PL', 'Pail'),
  ('PR', 'Pair'),
  ('PT', 'Pint (US)'),
  ('RL', 'Reel'),
  ('RO', 'Roll'),
  ('SET', 'Set'),
  ('SK', 'Sack'),
  ('SMI', 'Mile ( mile )'),
  ('ST', 'Ton (short,2000 lb)'),
  ('STK', 'Stick, Cigarette '),
  ('T3', 'Thousand piece'),
  ('TC', 'Truckload'),
  ('TK', 'Tank, rectangular'),
  ('TN', 'Tin'),
  ('TNE', 'Tonne ( t )'),
  ('TON', 'Ton (metric)'),
  ('TTS', 'Ten thousand sticks'),
  ('UC', 'Telecommunication port '),
  ('VI', 'Vial'),
  ('VLT', 'Volt ( V )'),
  ('VQ', 'Bulk'),
  ('WEE', 'Weeks ( Weeks )'),
  ('WTT', 'Watt ( W )'),
  ('X03', 'Meter/Hour ( m/h )'),
  ('YDK', 'Square yard'),
  ('YDQ', 'Cubic yard ( yd3 )'),
  ('YRD', 'Yards ( yd )'),
  ('Z3', 'Cask')
on conflict (code) do nothing;

-- ---------------------------------------------------------------- company tax profile, branches, rates

create table if not exists public.tax_profiles (
  org_id              uuid primary key references public.organizations(id),
  registration_number text not null check (registration_number ~ '^[0-9A-Za-z-]{3,30}$'),
  legal_name          text not null check (length(trim(legal_name)) between 1 and 200),
  activity_code       text not null check (activity_code ~ '^[0-9]{3,10}$'),
  -- How this company talks to ETA: simulated (nothing leaves our system, the default), preprod (ETA test system), production.
  eta_mode            text not null default 'simulated' check (eta_mode in ('simulated', 'preprod', 'production')),
  updated_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create table if not exists public.tax_branches (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id),
  branch_code            text not null check (branch_code ~ '^[0-9A-Za-z-]{1,20}$'),
  name                   text not null check (length(trim(name)) between 1 and 200),
  country                char(2) not null default 'EG' check (country ~ '^[A-Z]{2}$'),
  governate              text not null check (length(trim(governate)) > 0),
  region_city            text not null check (length(trim(region_city)) > 0),
  street                 text not null check (length(trim(street)) > 0),
  building_number        text not null check (length(trim(building_number)) > 0),
  postal_code            text,
  floor                  text,
  room                   text,
  landmark               text,
  additional_information text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  unique (org_id, id)
);
create unique index if not exists tax_branches_org_code_active_uq on public.tax_branches (org_id, branch_code) where deleted_at is null;

create table if not exists public.tax_rates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  tax_type   text not null,
  sub_type   text not null,
  rate       numeric(8, 5) not null check (rate >= 0 and rate <= 999),
  label      text not null check (length(trim(label)) between 1 and 100),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, id),
  foreign key (tax_type, sub_type) references public.eta_tax_subtypes (tax_type, sub_type)
);
-- One default rate per tax type per company.
create unique index if not exists tax_rates_org_default_uq on public.tax_rates (org_id, tax_type) where is_default and deleted_at is null;
create unique index if not exists tax_rates_org_label_uq on public.tax_rates (org_id, lower(label)) where deleted_at is null;

drop trigger if exists tax_profiles_updated_at on public.tax_profiles;
create trigger tax_profiles_updated_at before update on public.tax_profiles for each row execute function public.set_updated_at();
drop trigger if exists tax_branches_updated_at on public.tax_branches;
create trigger tax_branches_updated_at before update on public.tax_branches for each row execute function public.set_updated_at();
drop trigger if exists tax_rates_updated_at on public.tax_rates;
create trigger tax_rates_updated_at before update on public.tax_rates for each row execute function public.set_updated_at();

alter table public.tax_profiles enable row level security;
alter table public.tax_branches enable row level security;
alter table public.tax_rates enable row level security;
revoke all on public.tax_profiles, public.tax_branches, public.tax_rates from anon, authenticated;
grant select on public.tax_profiles, public.tax_branches, public.tax_rates to authenticated;
drop policy if exists tax_profiles_member_read on public.tax_profiles;
create policy tax_profiles_member_read on public.tax_profiles for select to authenticated using (public.is_org_member(org_id));
drop policy if exists tax_branches_member_read on public.tax_branches;
create policy tax_branches_member_read on public.tax_branches for select to authenticated using (public.is_org_member(org_id));
drop policy if exists tax_rates_member_read on public.tax_rates;
create policy tax_rates_member_read on public.tax_rates for select to authenticated using (public.is_org_member(org_id));

-- ---------------------------------------------------------------- customer tax identity, item codes

alter table public.sal_customers add column if not exists tax_id_type char(1);
alter table public.sal_customers add column if not exists tax_id text;
alter table public.sal_customers add column if not exists country char(2);
alter table public.sal_customers add column if not exists governate text;
alter table public.sal_customers add column if not exists region_city text;
alter table public.sal_customers add column if not exists street text;
alter table public.sal_customers add column if not exists building_number text;
alter table public.sal_customers drop constraint if exists sal_customers_tax_id_type_check;
alter table public.sal_customers add constraint sal_customers_tax_id_type_check check (tax_id_type is null or tax_id_type in ('B', 'P', 'F'));
alter table public.sal_customers drop constraint if exists sal_customers_country_check;
alter table public.sal_customers add constraint sal_customers_country_check check (country is null or country ~ '^[A-Z]{2}$');

alter table public.inv_items add column if not exists eta_item_type text;
alter table public.inv_items add column if not exists eta_item_code text;
alter table public.inv_items add column if not exists eta_unit_code text;
alter table public.inv_items add column if not exists default_tax_rate_id uuid;
alter table public.inv_items drop constraint if exists inv_items_eta_item_type_check;
alter table public.inv_items add constraint inv_items_eta_item_type_check check (eta_item_type is null or eta_item_type in ('GS1', 'EGS'));
alter table public.inv_items drop constraint if exists inv_items_eta_unit_fk;
alter table public.inv_items add constraint inv_items_eta_unit_fk foreign key (eta_unit_code) references public.eta_unit_types (code);
alter table public.inv_items drop constraint if exists inv_items_default_tax_rate_fk;
alter table public.inv_items add constraint inv_items_default_tax_rate_fk foreign key (org_id, default_tax_rate_id) references public.tax_rates (org_id, id);
-- inv_items uses column grants (sql/023): a new column must be granted explicitly or the API cannot read it.
grant select (eta_item_type, eta_item_code, eta_unit_code, default_tax_rate_id) on public.inv_items to authenticated;

-- ---------------------------------------------------------------- functions

create or replace function public.eta__guard(p_roles text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.require_org_role(p_roles);
begin
  if not exists (select 1 from public.org_modules m where m.org_id = v_org and m.module_key = 'einvoicing' and m.disabled_at is null) then
    raise exception 'MODULE_DISABLED';
  end if;
  return v_org;
end $$;

-- Company tax registration and the ETA mode. Owner or admin.
--   simulated  (default): documents are built and checked but never leave our system; anything "sent" is labelled SIMULATED.
--   preprod:   ETA's test system; needs the company's PreProd credentials at send time (checked by the API, not stored here yet).
--   production: REFUSED here for now (PRODUCTION_NOT_READY). It is only allowed once encrypted credential storage and a real
--              signer exist and are configured for the company; a later migration lifts this and must test that rule.
create or replace function public.eta_save_profile(p_registration_number text, p_legal_name text, p_activity_code text, p_mode text default 'simulated') returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.eta__guard(array['owner', 'admin']);
  v_old public.tax_profiles;
begin
  if p_mode is null or p_mode not in ('simulated', 'preprod', 'production') then raise exception 'INVALID_INPUT' using detail = 'mode must be simulated, preprod or production'; end if;
  if p_mode = 'production' then
    raise exception 'PRODUCTION_NOT_READY' using detail = 'production needs stored ETA credentials and a real signer, which are not set up yet';
  end if;
  if coalesce(trim(p_registration_number), '') !~ '^[0-9A-Za-z-]{3,30}$' then raise exception 'INVALID_INPUT' using detail = 'the registration number is not valid'; end if;
  if coalesce(trim(p_activity_code), '') !~ '^[0-9]{3,10}$' then raise exception 'INVALID_INPUT' using detail = 'the activity code is not valid'; end if;
  if length(trim(coalesce(p_legal_name, ''))) = 0 then raise exception 'INVALID_INPUT' using detail = 'the legal name is missing'; end if;
  select * into v_old from public.tax_profiles where org_id = v_org for update;
  insert into public.tax_profiles (org_id, registration_number, legal_name, activity_code, eta_mode, updated_by)
  values (v_org, trim(p_registration_number), trim(p_legal_name), trim(p_activity_code), p_mode, auth.uid())
  on conflict (org_id) do update set registration_number = excluded.registration_number, legal_name = excluded.legal_name,
    activity_code = excluded.activity_code, eta_mode = excluded.eta_mode, updated_by = excluded.updated_by;
  -- A change of mode is a deliberate step and is audited with its own action name.
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(),
          case when v_old.eta_mode is not null and v_old.eta_mode <> p_mode then 'einvoicing.profile.mode_changed' else 'einvoicing.profile.saved' end,
          'tax_profile', v_org::text,
          format('Registration %s, activity %s, ETA mode %s%s', trim(p_registration_number), trim(p_activity_code), p_mode,
                 case when v_old.eta_mode is not null and v_old.eta_mode <> p_mode then format(' (was %s)', v_old.eta_mode) else '' end));
end $$;
-- Create or update a branch (p_id null creates). Owner or admin. The code is the one registered with ETA.
create or replace function public.eta_save_branch(p_id uuid, p_branch_code text, p_name text, p_governate text, p_region_city text, p_street text,
  p_building_number text, p_postal_code text default null, p_floor text default null, p_room text default null, p_landmark text default null,
  p_additional text default null, p_country text default 'EG') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.eta__guard(array['owner', 'admin']);
  v_id  uuid;
begin
  if coalesce(trim(p_branch_code), '') !~ '^[0-9A-Za-z-]{1,20}$' or length(trim(coalesce(p_name, ''))) = 0
     or length(trim(coalesce(p_governate, ''))) = 0 or length(trim(coalesce(p_region_city, ''))) = 0
     or length(trim(coalesce(p_street, ''))) = 0 or length(trim(coalesce(p_building_number, ''))) = 0
     or coalesce(p_country, '') !~ '^[A-Z]{2}$' then
    raise exception 'INVALID_INPUT' using detail = 'branch code, name, governate, region or city, street and building number are required';
  end if;
  if p_id is null then
    insert into public.tax_branches (org_id, branch_code, name, country, governate, region_city, street, building_number, postal_code, floor, room, landmark, additional_information)
    values (v_org, trim(p_branch_code), trim(p_name), p_country, trim(p_governate), trim(p_region_city), trim(p_street), trim(p_building_number),
            nullif(trim(p_postal_code), ''), nullif(trim(p_floor), ''), nullif(trim(p_room), ''), nullif(trim(p_landmark), ''), nullif(trim(p_additional), ''))
    returning id into v_id;
  else
    update public.tax_branches b set branch_code = trim(p_branch_code), name = trim(p_name), country = p_country, governate = trim(p_governate),
      region_city = trim(p_region_city), street = trim(p_street), building_number = trim(p_building_number), postal_code = nullif(trim(p_postal_code), ''),
      floor = nullif(trim(p_floor), ''), room = nullif(trim(p_room), ''), landmark = nullif(trim(p_landmark), ''), additional_information = nullif(trim(p_additional), '')
    where b.org_id = v_org and b.id = p_id and b.deleted_at is null returning b.id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), case when p_id is null then 'einvoicing.branch.created' else 'einvoicing.branch.updated' end, 'tax_branch', v_id::text,
          format('Branch %s (%s)', trim(p_name), trim(p_branch_code)));
  return v_id;
end $$;

create or replace function public.eta_remove_branch(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.eta__guard(array['owner', 'admin']);
  b     public.tax_branches;
begin
  update public.tax_branches x set deleted_at = now() where x.org_id = v_org and x.id = p_id and x.deleted_at is null returning x.* into b;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'einvoicing.branch.removed', 'tax_branch', b.id::text, format('Branch %s (%s) removed', b.name, b.branch_code));
end $$;

-- Create or update a tax rate (p_id null creates). The type and subtype must be an ETA pair. Which rate applies to which product
-- is the company's accountant's decision; this table only holds the choices. A default rate is unique per tax type.
create or replace function public.eta_save_tax_rate(p_id uuid, p_tax_type text, p_sub_type text, p_rate numeric, p_label text, p_is_default boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.eta__guard(array['owner', 'admin']);
  v_id  uuid;
begin
  if not exists (select 1 from public.eta_tax_subtypes s where s.tax_type = p_tax_type and s.sub_type = p_sub_type) then
    raise exception 'INVALID_INPUT' using detail = 'that tax type and subtype are not an ETA pair';
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 999 or length(trim(coalesce(p_label, ''))) = 0 then
    raise exception 'INVALID_INPUT' using detail = 'a rate from 0 to 999 and a label are required';
  end if;
  if coalesce(p_is_default, false) then
    update public.tax_rates r set is_default = false where r.org_id = v_org and r.tax_type = p_tax_type and r.is_default and r.deleted_at is null and r.id is distinct from p_id;
  end if;
  if p_id is null then
    insert into public.tax_rates (org_id, tax_type, sub_type, rate, label, is_default)
    values (v_org, p_tax_type, p_sub_type, p_rate, trim(p_label), coalesce(p_is_default, false)) returning id into v_id;
  else
    update public.tax_rates r set tax_type = p_tax_type, sub_type = p_sub_type, rate = p_rate, label = trim(p_label), is_default = coalesce(p_is_default, false)
    where r.org_id = v_org and r.id = p_id and r.deleted_at is null returning r.id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), case when p_id is null then 'einvoicing.rate.created' else 'einvoicing.rate.updated' end, 'tax_rate', v_id::text,
          format('%s: %s/%s at %s%%%s', trim(p_label), p_tax_type, p_sub_type, p_rate, case when coalesce(p_is_default, false) then ' (default)' else '' end));
  return v_id;
end $$;

create or replace function public.eta_remove_tax_rate(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.eta__guard(array['owner', 'admin']);
  r     public.tax_rates;
begin
  select * into r from public.tax_rates x where x.org_id = v_org and x.id = p_id and x.deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.inv_items i where i.org_id = v_org and i.default_tax_rate_id = r.id and i.deleted_at is null) then
    raise exception 'IN_USE' using detail = 'items still use this tax rate';
  end if;
  update public.tax_rates x set deleted_at = now(), is_default = false where x.id = r.id;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'einvoicing.rate.removed', 'tax_rate', r.id::text, format('%s removed', r.label));
end $$;

-- A customer's tax identity and address as ETA wants them. B = business in Egypt (registration number), P = person (national ID),
-- F = foreign (foreign VAT ID). A business or foreign customer needs an id and an address. Owner or admin.
create or replace function public.eta_set_customer_tax(p_customer_id uuid, p_tax_id_type text, p_tax_id text, p_country text, p_governate text,
  p_region_city text, p_street text, p_building_number text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.eta__guard(array['owner', 'admin']);
  v_name text;
begin
  if p_tax_id_type is null or p_tax_id_type not in ('B', 'P', 'F') then raise exception 'INVALID_INPUT' using detail = 'type must be B, P or F'; end if;
  if p_tax_id_type in ('B', 'F') and (length(trim(coalesce(p_tax_id, ''))) = 0 or length(trim(coalesce(p_governate, ''))) = 0
       or length(trim(coalesce(p_region_city, ''))) = 0 or length(trim(coalesce(p_street, ''))) = 0 or length(trim(coalesce(p_building_number, ''))) = 0) then
    raise exception 'INVALID_INPUT' using detail = 'a business or foreign customer needs a tax id and a full address';
  end if;
  if p_country is not null and p_country !~ '^[A-Z]{2}$' then raise exception 'INVALID_INPUT' using detail = 'country must be a 2-letter code'; end if;
  update public.sal_customers c set tax_id_type = p_tax_id_type, tax_id = nullif(trim(p_tax_id), ''), country = coalesce(p_country, 'EG'),
    governate = nullif(trim(p_governate), ''), region_city = nullif(trim(p_region_city), ''), street = nullif(trim(p_street), ''),
    building_number = nullif(trim(p_building_number), '')
  where c.org_id = v_org and c.id = p_customer_id and c.deleted_at is null returning c.name into v_name;
  if v_name is null then raise exception 'NOT_FOUND'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'einvoicing.customer.tax_set', 'customer', p_customer_id::text, format('%s: tax identity type %s', v_name, p_tax_id_type));
end $$;

-- An item's ETA code (GS1 or EGS), unit code and default tax rate. An EGS code must be EG-<registration number>-<internal code>
-- once the company's registration number is saved (official format, SDK "Create EGS code usage"). Owner or admin.
create or replace function public.eta_set_item_codes(p_item_id uuid, p_item_type text, p_item_code text, p_unit_code text, p_tax_rate_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.eta__guard(array['owner', 'admin']);
  v_reg text;
  v_sku text;
begin
  if p_item_type is null or p_item_type not in ('GS1', 'EGS') or length(trim(coalesce(p_item_code, ''))) = 0 then
    raise exception 'INVALID_INPUT' using detail = 'item type (GS1 or EGS) and code are required';
  end if;
  if not exists (select 1 from public.eta_unit_types u where u.code = p_unit_code) then raise exception 'INVALID_INPUT' using detail = 'unknown ETA unit code'; end if;
  if p_tax_rate_id is not null and not exists (select 1 from public.tax_rates r where r.org_id = v_org and r.id = p_tax_rate_id and r.deleted_at is null) then
    raise exception 'INVALID_INPUT' using detail = 'unknown tax rate';
  end if;
  select registration_number into v_reg from public.tax_profiles where org_id = v_org;
  if p_item_type = 'EGS' and v_reg is not null and trim(p_item_code) not like 'EG-' || v_reg || '-_%' then
    raise exception 'INVALID_INPUT' using detail = format('an EGS code looks like EG-%s-<your code>', v_reg);
  end if;
  update public.inv_items i set eta_item_type = p_item_type, eta_item_code = trim(p_item_code), eta_unit_code = p_unit_code, default_tax_rate_id = p_tax_rate_id
  where i.org_id = v_org and i.id = p_item_id and i.deleted_at is null returning i.sku into v_sku;
  if v_sku is null then raise exception 'NOT_FOUND'; end if;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_org, auth.uid(), 'einvoicing.item.codes_set', 'item', p_item_id::text, format('%s: %s code %s, unit %s', v_sku, p_item_type, trim(p_item_code), p_unit_code));
end $$;

revoke all on function public.eta__guard(text[]) from public, anon, authenticated;
revoke all on function public.eta_save_profile(text, text, text, text), public.eta_save_branch(uuid, text, text, text, text, text, text, text, text, text, text, text, text),
  public.eta_remove_branch(uuid), public.eta_save_tax_rate(uuid, text, text, numeric, text, boolean), public.eta_remove_tax_rate(uuid),
  public.eta_set_customer_tax(uuid, text, text, text, text, text, text, text), public.eta_set_item_codes(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.eta_save_profile(text, text, text, text), public.eta_save_branch(uuid, text, text, text, text, text, text, text, text, text, text, text, text),
  public.eta_remove_branch(uuid), public.eta_save_tax_rate(uuid, text, text, numeric, text, boolean), public.eta_remove_tax_rate(uuid),
  public.eta_set_customer_tax(uuid, text, text, text, text, text, text, text), public.eta_set_item_codes(uuid, text, text, text, uuid) to authenticated;

commit;

-- Verification (read-only): expect 3 business tables with RLS, 56 subtypes, 143 unit codes, helper not callable by users (false).
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('tax_profiles', 'tax_branches', 'tax_rates') and relrowsecurity) as business_tables_with_rls,
       (select count(*) from public.eta_tax_subtypes) as subtypes,
       (select count(*) from public.eta_unit_types) as unit_codes,
       has_function_privilege('authenticated', 'public.eta__guard(text[])', 'execute') as helper_callable;
