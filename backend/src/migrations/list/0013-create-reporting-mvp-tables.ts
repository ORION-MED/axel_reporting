import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 13,
        name: 'create_reporting_mvp_tables',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_indicators (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            unit TEXT NOT NULL DEFAULT '%',
            formula_text TEXT NOT NULL DEFAULT '',
            numerator_label TEXT NOT NULL DEFAULT '',
            denominator_label TEXT NOT NULL DEFAULT '',
            methodology_status TEXT NOT NULL DEFAULT 'ready',
            is_mvp BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_indicators_methodology_status_chk
                CHECK (methodology_status IN ('ready', 'in_development'))
        );

        CREATE TABLE IF NOT EXISTS reporting_periods (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            date_from DATE,
            date_to DATE,
            status TEXT NOT NULL DEFAULT 'draft',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_periods_status_chk
                CHECK (status IN ('draft', 'active', 'closed'))
        );

        CREATE TABLE IF NOT EXISTS reporting_indicator_values (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            indicator_id TEXT NOT NULL REFERENCES reporting_indicators(id) ON DELETE CASCADE,
            period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
            numerator NUMERIC,
            denominator NUMERIC,
            fact_value NUMERIC,
            target_value NUMERIC,
            status TEXT NOT NULL DEFAULT 'awaiting_data',
            note TEXT NOT NULL DEFAULT '',
            source_name TEXT NOT NULL DEFAULT '',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(indicator_id, period_id),
            CONSTRAINT reporting_indicator_values_status_chk
                CHECK (status IN ('awaiting_data', 'calculated', 'methodology_in_development', 'not_calculated'))
        );

        CREATE INDEX IF NOT EXISTS reporting_indicator_values_period_idx
            ON reporting_indicator_values(period_id);
        CREATE INDEX IF NOT EXISTS reporting_indicator_values_indicator_idx
            ON reporting_indicator_values(indicator_id);

        INSERT INTO reporting_indicators (
            id,
            code,
            title,
            unit,
            formula_text,
            numerator_label,
            denominator_label,
            methodology_status,
            is_mvp,
            sort_order,
            metadata
        )
        VALUES
            (
                'semd_outpatient_epicrisis',
                '6.1.3.2.8',
                'Доля завершенных случаев оказания медицинской помощи в амбулаторных условиях, по которым передан СЭМД в РЭМД',
                '%',
                'Число переданных СЭМД по завершенным амбулаторным случаям / число завершенных амбулаторных случаев * 100',
                'СЭМД: эпикриз по завершенному случаю в амбулаторных условиях',
                'Завершенные амбулаторные случаи из учетной системы/ФОМС',
                'ready',
                TRUE,
                10,
                '{"contextSource":"AXEL_transfer_context_2026-06-25","remdWorkbookColumn":"Эпикриз по законченному случаю в амбулаторных условиях"}'::jsonb
            ),
            (
                'semd_preventive_exam',
                '6.1.3.2.9',
                'Доля результатов профилактических осмотров и диспансеризации, переданных в РЭМД',
                '%',
                'Число переданных СЭМД по результатам профилактических мероприятий / число завершенных профилактических мероприятий * 100',
                'СЭМД: результат профилактического осмотра или диспансеризации',
                'Завершенные профилактические мероприятия из учетной системы/ФОМС',
                'ready',
                TRUE,
                20,
                '{"contextSource":"AXEL_transfer_context_2026-06-25","remdWorkbookColumn":"Результат профилактического медицинского осмотра и диспансеризации"}'::jsonb
            ),
            (
                'semd_inpatient_discharge',
                '6.1.3.2.10',
                'Доля случаев стационарной помощи, по которым передан выписной эпикриз в РЭМД',
                '%',
                'Число переданных выписных эпикризов / число завершенных случаев стационарной помощи * 100',
                'СЭМД: выписной эпикриз из стационара',
                'Завершенные случаи стационарной помощи из учетной системы/ФОМС',
                'ready',
                TRUE,
                30,
                '{"contextSource":"AXEL_transfer_context_2026-06-25","remdWorkbookColumns":["Выписной эпикриз из стационара","Выписной эпикриз из родильного дома"]}'::jsonb
            ),
            (
                'semd_ambulance_call_card',
                '6.1.3.2.11',
                'Доля вызовов скорой медицинской помощи, по которым передана карта вызова СМП в РЭМД',
                '%',
                'Число переданных СЭМД карт вызова СМП / число завершенных вызовов СМП * 100',
                'СЭМД: карта вызова скорой медицинской помощи',
                'Завершенные вызовы СМП из учетной системы/ФОМС',
                'ready',
                TRUE,
                40,
                '{"contextSource":"AXEL_transfer_context_2026-06-25","remdWorkbookColumn":"Карта вызова скорой медицинской помощи"}'::jsonb
            ),
            (
                'semd_birth_certificate',
                '6.1.3.2.12',
                'Доля медицинских свидетельств о рождении, переданных в РЭМД',
                '%',
                'Число переданных медицинских свидетельств о рождении / число актовых записей о рождении * 100',
                'СЭМД: медицинское свидетельство о рождении',
                'Актовые записи о рождении из ЕГР ЗАГС',
                'ready',
                TRUE,
                50,
                '{"contextSource":"AXEL_transfer_context_2026-06-25","remdWorkbookColumn":"Медицинское свидетельство о рождении"}'::jsonb
            )
        ON CONFLICT (id) DO UPDATE SET
            code = EXCLUDED.code,
            title = EXCLUDED.title,
            unit = EXCLUDED.unit,
            formula_text = EXCLUDED.formula_text,
            numerator_label = EXCLUDED.numerator_label,
            denominator_label = EXCLUDED.denominator_label,
            methodology_status = EXCLUDED.methodology_status,
            is_mvp = EXCLUDED.is_mvp,
            sort_order = EXCLUDED.sort_order,
            metadata = EXCLUDED.metadata,
            updated_at = now();
        `,
}
