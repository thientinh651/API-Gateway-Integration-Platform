-- PA2: gateway_routes.retry_on_status / allowed_methods TEXT (CSV) → PostgreSQL arrays (1NF).
-- Rewritten without subqueries in ALTER COLUMN USING (unsupported in some PG builds).

-- Step 1: add temporary array columns
ALTER TABLE gateway_routes ADD COLUMN IF NOT EXISTS retry_on_status_new INTEGER[];
ALTER TABLE gateway_routes ADD COLUMN IF NOT EXISTS allowed_methods_new TEXT[];

-- Step 2: backfill via DO block (no subquery in transform expression)
DO $$
DECLARE
    r RECORD;
    raw TEXT[];
    result_ints INTEGER[];
    result_texts TEXT[];
    part TEXT;
BEGIN
    FOR r IN SELECT id, retry_on_status, allowed_methods FROM gateway_routes LOOP
        -- retry_on_status: comma-separated integers → int[]
        result_ints := ARRAY[]::INTEGER[];
        IF r.retry_on_status IS NOT NULL AND trim(r.retry_on_status) <> '' THEN
            raw := string_to_array(r.retry_on_status, ',');
            FOREACH part IN ARRAY raw LOOP
                part := trim(part);
                IF part ~ '^\d+$' THEN
                    result_ints := array_append(result_ints, part::INTEGER);
                END IF;
            END LOOP;
        END IF;

        -- allowed_methods: comma-separated methods → text[]
        result_texts := ARRAY[]::TEXT[];
        IF r.allowed_methods IS NULL OR trim(r.allowed_methods) = '' OR trim(r.allowed_methods) = '*' THEN
            result_texts := ARRAY['*']::TEXT[];
        ELSE
            raw := string_to_array(r.allowed_methods, ',');
            FOREACH part IN ARRAY raw LOOP
                part := upper(trim(part));
                IF part <> '' THEN
                    result_texts := array_append(result_texts, part);
                END IF;
            END LOOP;
            IF array_length(result_texts, 1) IS NULL THEN
                result_texts := ARRAY['*']::TEXT[];
            END IF;
        END IF;

        UPDATE gateway_routes
           SET retry_on_status_new = result_ints,
               allowed_methods_new = result_texts
         WHERE id = r.id;
    END LOOP;
END $$;

-- Step 3: swap columns
ALTER TABLE gateway_routes DROP COLUMN retry_on_status;
ALTER TABLE gateway_routes RENAME COLUMN retry_on_status_new TO retry_on_status;
ALTER TABLE gateway_routes ALTER COLUMN retry_on_status SET DEFAULT ARRAY[502, 503, 504]::INTEGER[];

ALTER TABLE gateway_routes DROP COLUMN allowed_methods;
ALTER TABLE gateway_routes RENAME COLUMN allowed_methods_new TO allowed_methods;
ALTER TABLE gateway_routes ALTER COLUMN allowed_methods SET DEFAULT ARRAY['*']::TEXT[];
