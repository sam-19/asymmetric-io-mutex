/**
 * Asymmetric I/O Mutex types.
 * @package    asymmetric-io-mutex
 * @copyright  2022 Sampsa Lohi
 * @license    MIT
 */

import { ReadonlyFloat32Array, ReadonlyInt8Array, ReadonlyInt16Array, ReadonlyInt32Array, ReadonlyUint8Array, ReadonlyUint16Array, ReadonlyUint32Array } from "./ReadonlyTypedArray"

export interface AsymmetricMutex {
    EMPTY_FIELD: number
    propertiesForCoupling: MutexExportProperties
    outputMetaBuffer: SharedArrayBuffer | null
    outputMetaFields: MutexMetaField[]
    writeLockBuffer: SharedArrayBuffer
    executeWithLock: (scope: MutexScope, mode: MutexMode, f: () => any) => void
    isAvailable: (scope: MutexScope, mode: MutexMode) => boolean
    lock: (scope: MutexScope, mode: MutexMode) => Promise<boolean>
    onceAvailable: (scope: MutexScope, mode: MutexMode) => Promise<void>
    releaseBuffers: () => void
    unlock: (scope: MutexScope, mode: MutexMode) => boolean
    waitForFieldUpdate: (fieldType: 'data' | 'meta', fieldIndex: number, dataIndex?: number) => Promise<number|null>
}

export type MutexExportProperties = {
    dataBuffers: SharedArrayBuffer[]
    dataFields: MutexMetaField[]
    lockBuffer: SharedArrayBuffer
    metaBuffer: SharedArrayBuffer | null
    metaFields: MutexMetaField[]
}

export type MutexMetaField = {
    length: number
    name: string
    position: number
    data?: number[] | TypedNumberArray
}

export type MutexMode = 'r' | 'w'
export type MutexScope = 'i' | 'o'

export type TypedNumberArray = Float32Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array
export type TypedNumberArrayConstructor = Float32ArrayConstructor |
                                          Int8ArrayConstructor | Int16ArrayConstructor | Int32ArrayConstructor |
                                          Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor

export type ReadonlyTypedArray = ReadonlyInt8Array | ReadonlyInt16Array | ReadonlyInt32Array | ReadonlyFloat32Array |
                                 ReadonlyUint8Array | ReadonlyUint16Array | ReadonlyUint32Array
