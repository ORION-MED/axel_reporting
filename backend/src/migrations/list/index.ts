import type { Migration } from '../migration.types'
import { migration as m0001 } from './0001-create-users-table'
import { migration as m0002 } from './0002-add-user-bio-column'
import { migration as m0003 } from './0003-seed-admin-user'
import { migration as m0004 } from './0004-create-publications-table'
import { migration as m0005 } from './0005-add-publication-visibility-flags'
import { migration as m0006 } from './0006-create-uploads-table'
import { migration as m0007 } from './0007-create-processing-jobs-table'
import { migration as m0008 } from './0008-create-artifacts-table'
import { migration as m0009 } from './0009-create-dataset-profiles-table'
import { migration as m0010 } from './0010-add-uploads-checksum-user-index'
import { migration as m0011 } from './0011-add-users-token-version'
import { migration as m0012 } from './0012-add-uploads-checksum-unique-index'
import { migration as m0013 } from './0013-create-reporting-mvp-tables'
import { migration as m0014 } from './0014-create-reporting-organization-values'
import { migration as m0015 } from './0015-align-reporting-indicators-with-methodology'
import { migration as m0016 } from './0016-create-reporting-import-journal-and-snapshots'
import { migration as m0017 } from './0017-add-user-roles'
import { migration as m0018 } from './0018-add-reporting-import-mode'
import { migration as m0019 } from './0019-create-reporting-organization-components'
import { migration as m0020 } from './0020-add-reporting-business-status'
import { migration as m0021 } from './0021-add-reporting-pilot-indicator-contract'
import { migration as m0022 } from './0022-create-reporting-organization-directory'
import { migration as m0023 } from './0023-create-reporting-semd-facts-and-diagnostics'
import { migration as m0024 } from './0024-add-reporting-import-preview-state'
import { migration as m0025 } from './0025-add-pilot-indicator-calculation-details'
import { migration as m0026 } from './0026-create-reporting-tpgg-plan-values'
import { migration as m0027 } from './0027-create-reporting-semd-requirement-overrides'
import { migration as m0028 } from './0028-add-reporting-semd-requirements-recalc-index'
import { migration as m0029 } from './0029-add-death-certificate-indicator'
import { migration as m0030 } from './0030-create-reporting-organization-external-ids'
import { migration as m0031 } from './0031-add-semd-type-official-oid-and-epgu-visibility'
import { migration as m0032 } from './0032-add-semd-type-official-name-5pr'
import { migration as m0033 } from './0033-add-organization-activity-type'
import { migration as m0034 } from './0034-create-reporting-organization-subdivisions'
import { migration as m0035 } from './0035-create-reporting-remd-subdivision-facts'
import { migration as m0036 } from './0036-create-reporting-semd-applicability-rules'
import { migration as m0037 } from './0037-create-reporting-semd-gis-availability'
import { migration as m0038 } from './0038-clear-requirement-regional-gis-heuristic'
import { migration as m0039 } from './0039-create-reporting-organization-attributes'
import { migration as m0040 } from './0040-official-indicator-title-6-1-3-2-7'
import { migration as m0041 } from './0041-add-semd-volume-ratio-indicators'
import { migration as m0042 } from './0042-add-semd-type-registry-indicator'
import { migration as m0043 } from './0043-add-organization-llo-program'
import { migration as m0044 } from './0044-allow-llo-program-condition'
import { migration as m0045 } from './0045-hide-certificate-indicators'
import { migration as m0046 } from './0046-add-tpgg-monthly-values'
import { migration as m0047 } from './0047-add-target-year-end-value'
import { migration as m0048 } from './0048-add-indicator-short-title'
import { migration as m0049 } from './0049-seed-working-matrix-aliases'
import { migration as m0050 } from './0050-allow-organization-list-except-condition'
import { migration as m0051 } from './0051-seed-exclusion-list-aliases'
import { migration as m0052 } from './0052-allow-organization-list-condition'
import { migration as m0053 } from './0053-seed-bureau-sme-alias'
import { migration as m0054 } from './0054-update-registry-numerator-scope-note'
import { migration as m0055 } from './0055-create-reporting-remd-interval-facts'
import { migration as m0056 } from './0056-create-reporting-tpgg-execution-values'
import { migration as m0057 } from './0057-create-reporting-inclusion-registers'
import { migration as m0058 } from './0058-seed-pregnancy-registration-indicator'
import { migration as m0059 } from './0059-add-building-to-remd-interval-facts'
import { migration as m0060 } from './0060-hide-pregnancy-registration-indicator'
import { migration as m0061 } from './0061-repair-mojibake-source-names'
import { migration as m0062 } from './0062-allow-license-1090-5-condition'
import { migration as m0063 } from './0063-seed-dispensary-observation-indicator'
import { migration as m0064 } from './0064-allow-inpatient-or-day-hospital-condition'
import { migration as m0065 } from './0065-create-reporting-remd-annual-facts'
import { migration as m0066 } from './0066-allow-group-organization-alias'

export const migrations: Migration[] = [
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
    m0006,
    m0007,
    m0008,
    m0009,
    m0010,
    m0011,
    m0012,
    m0013,
    m0014,
    m0015,
    m0016,
    m0017,
    m0018,
    m0019,
    m0020,
    m0021,
    m0022,
    m0023,
    m0024,
    m0025,
    m0026,
    m0027,
    m0028,
    m0029,
    m0030,
    m0031,
    m0032,
    m0033,
    m0034,
    m0035,
    m0036,
    m0037,
    m0038,
    m0039,
    m0040,
    m0041,
    m0042,
    m0043,
    m0044,
    m0045,
    m0046,
    m0047,
    m0048,
    m0049,
    m0050,
    m0051,
    m0052,
    m0053,
    m0054,
    m0055,
    m0056,
    m0057,
    m0058,
    m0059,
    m0060,
    m0061,
    m0062,
    m0063,
    m0064,
    m0065,
    m0066,
]
