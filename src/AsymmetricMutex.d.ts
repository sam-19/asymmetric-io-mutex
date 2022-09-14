/**
 * Asymmetric IO Mutex types.
 * @package    asymmetric-io-mutex
 * @copyright  2022 Sampsa Lohi
 * @license    MIT
 */

export interface AsymmetricMutex {
    executeWithLock: (scope: MutexScope, mode: MutexMode, f: () => any) => void
    isAvailable: (scope: MutexScope, mode: MutexMode) => boolean
    lock: (scope: MutexScope, mode: MutexMode) => Promise<boolean>
    onceAvailable: (scope: MutexScope, mode: MutexMode) => Promise<void>
    unlock: (scope: MutexScope, mode: MutexMode) => boolean
    waitForFieldUpdate: (fieldType: 'data' | 'meta', fieldIndex: number, dataIndex?: number) => Promise<number|null>
}

export type MutexExportFields = {
    dataBuffers: SharedArrayBuffer[]
    dataFields: MutexMetaField[]
    lockBuffer: SharedArrayBuffer
    metaBuffer: SharedArrayBuffer | null
    metaFields: MutexMetaField[]
}

export type MutexMeta = {
    general: MutexMetaField[]
    arrays: (MutexMetaField | null)[]
}

export type MutexMetaField = {
    length: number
    name: string
    position: number
    data?: number | Float32Array | null
}

export type MutexMode = 'r' | 'w'
export type MutexScope = 'i' | 'o'
