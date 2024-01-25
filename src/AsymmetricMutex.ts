/**
 * Asymmetric I/O Mutex types.
 * @package    asymmetric-io-mutex
 * @copyright  2022 Sampsa Lohi
 * @license    MIT
 */

import { ReadonlyFloat32Array, ReadonlyInt8Array, ReadonlyInt16Array, ReadonlyInt32Array, ReadonlyUint8Array, ReadonlyUint16Array, ReadonlyUint32Array } from "./ReadonlyTypedArray"

export interface AsymmetricMutex {
    BUFFER_START: number
    EMPTY_FIELD: number
    propertiesForCoupling: MutexExportProperties
    outputDataViews: (TypedNumberArray | null)[]
    outputMetaView: TypedNumberArray | null
    outputMetaFields: MutexMetaField[]
    writeLockBuffer: SharedArrayBuffer | null
    executeWithLock: (scope: MutexScope, mode: MutexMode, f: () => any) => void
    isAvailable: (scope: MutexScope, mode: MutexMode) => boolean
    lock: (scope: MutexScope, mode: MutexMode) => Promise<boolean>
    onceAvailable: (scope: MutexScope, mode: MutexMode) => Promise<boolean>
    releaseBuffers: () => void
    unlock: (scope: MutexScope, mode: MutexMode) => boolean
    waitForFieldUpdate: (fieldType: 'data' | 'meta', fieldIndex: number, dataIndex?: number) => Promise<number|null>
}

export type ArrayBufferPart = {
    /**TODO: Option for a separate buffer from the mutex main buffer? NYI. */
    buffer: SharedArrayBuffer | null
    fields: MutexMetaField[]
    /** Total length of this buffer part. */
    length: number
    /** 32-bit position of this array part (from the part start). */
    position: number
}
export type ArrayBufferEntry = ArrayBufferPart&{
    view: TypedNumberArray | null
}
export type ArrayBufferList = ArrayBufferPart&{
    arrays: {
        constructor: TypedNumberArrayConstructor
        length: number
        /** 32-bit position of this array part (from the data part start). */
        position: number
        view: TypedNumberArray | null
    }[]
}

export type MutexExportProperties = {
    buffer: SharedArrayBuffer | null
    bufferStart: number,
    data: ArrayBufferList | null
    meta: ArrayBufferEntry
}

export type MutexMetaField = {
    constructor: TypedNumberArrayConstructor
    length: number
    name: string
    /** 32-bit position of this field. */
    position: number
    data?: number[] | TypedNumberArray
}

export type MutexMode = 'r' | 'w'
export type MutexScope = 'i' | 'o'

export type TypedNumberArray = Float32Array | Int32Array | Uint32Array
export type TypedNumberArrayConstructor = Float32ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor

export type ReadonlyTypedArray = ReadonlyInt32Array | ReadonlyFloat32Array | ReadonlyUint32Array
/* All number types up to 32 bit for reference
export type TypedNumberArray = Float32Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array
export type TypedNumberArrayConstructor = Float32ArrayConstructor |
                                          Int8ArrayConstructor | Int16ArrayConstructor | Int32ArrayConstructor |
                                          Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor

export type ReadonlyTypedArray = ReadonlyInt8Array | ReadonlyInt16Array | ReadonlyInt32Array | ReadonlyFloat32Array |
                                 ReadonlyUint8Array | ReadonlyUint16Array | ReadonlyUint32Array
*/
