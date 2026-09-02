import type { ApplicabilityConditionCode } from './applicability-matrix-xlsx'
import type { OrganizationAttributesRow } from './organization-directory-import.service'

/**
 * Разрешение конфликта между матрицей применимости и справочником признаков МО.
 *
 * Правило, принятое для всех справочников этого уровня (урок от 29.07 на признаке ГИС:
 * нельзя писать данные одного уровня в поле другого): матрица заполняет справочник
 * при первом импорте, дальше **справочник главнее**, а расхождение показывается
 * в предпросмотре матрицы, а не перезаписывается молча.
 *
 * Практически это значит: перечень МО для условий «прикреплённое население» и «лицензия…»
 * берётся из справочника, если он загружен и покрывает это условие; перечень из
 * комментария методолога остаётся в правиле для аудита и попадает в расхождения.
 */

/**
 * Точка отката. `false` возвращает прежнее поведение — перечни МО берутся разбором
 * текста комментария матрицы. Смена значения требует переимпорта матрицы, но не миграций.
 */
export const APPLICABILITY_USES_ORGANIZATION_DIRECTORY = true

export interface DirectoryOverride {
    /** OID, которых нет в комментарии, но есть в справочнике. */
    added: string[]
    /** OID, которые есть в комментарии, но справочник их не подтверждает. */
    removed: string[]
}

/**
 * Перечень МО, удовлетворяющих условию правила, по справочнику.
 * `null` — справочник это условие не покрывает, работает прежний разбор комментария.
 */
export function directoryOidsForCondition(
    conditionCode: ApplicabilityConditionCode,
    directory: ReadonlyMap<string, OrganizationAttributesRow>,
): Set<string> | null {
    if (!APPLICABILITY_USES_ORGANIZATION_DIRECTORY) return null
    if (directory.size === 0) return null

    if (conditionCode === 'attached_population') {
        return collect(directory, (row) => row.attachedPopulation)
    }
    if (conditionCode === 'attached_child_population') {
        return collect(directory, (row) => row.attachedChildPopulation)
    }
    if (conditionCode === 'llo_program') {
        // Признак появился в справочнике 13.08.2026. Пока колонки не было, признак
        // стоял `false` у всех — и перечень вышел бы пустым, то есть условие сняло бы
        // обязательность у всех МО. Поэтому пустой перечень здесь означает «справочник
        // это условие не покрывает», и работает прежний разбор комментария.
        const oids = collect(directory, (row) => row.lloProgram)
        return oids.size > 0 ? oids : null
    }

    const licenseCode = licenseCodeFromCondition(conditionCode)
    if (!licenseCode) return null
    // Лицензия, которой нет ни у одной МО, и лицензия, которой нет в файле, —
    // разные вещи. Во втором случае справочник условие не покрывает, и перезаписывать
    // перечень из комментария пустотой нельзя: так мы бы молча сняли обязательность.
    const licenseKnown = [...directory.values()].some(
        (row) => Object.prototype.hasOwnProperty.call(row.licenses ?? {}, licenseCode),
    )
    if (!licenseKnown) return null
    return collect(directory, (row) => Boolean(row.licenses?.[licenseCode]))
}

/** `license_1080_1` → `1080.1`; для прочих условий — пустая строка. */
export function licenseCodeFromCondition(conditionCode: string): string {
    const match = /^license_(\d{3,4})_(\d{1,2})$/u.exec(conditionCode)
    return match ? `${match[1]}.${match[2]}` : ''
}

/** Расхождение между перечнем из комментария и перечнем из справочника. */
export function buildDirectoryOverride(
    commentOids: ReadonlySet<string>,
    directoryOids: ReadonlySet<string>,
): DirectoryOverride {
    return {
        added: [...directoryOids].filter((oid) => !commentOids.has(oid)).sort(),
        removed: [...commentOids].filter((oid) => !directoryOids.has(oid)).sort(),
    }
}

export function isEmptyOverride(override: DirectoryOverride): boolean {
    return override.added.length === 0 && override.removed.length === 0
}

function collect(
    directory: ReadonlyMap<string, OrganizationAttributesRow>,
    predicate: (row: OrganizationAttributesRow) => boolean,
): Set<string> {
    const oids = new Set<string>()
    for (const [oid, row] of directory) {
        if (predicate(row)) oids.add(oid)
    }
    return oids
}
