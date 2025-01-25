/**
 * Asymmetric I/O Mutex types.
 * @package    asymmetric-io-mutex
 * @copyright  2025 Sampsa Lohi
 * @license    MIT
 */

import Log from "scoped-event-log"
import type { ReadonlyFloat32Array, ReadonlyInt32Array, ReadonlyUint32Array } from "./ReadonlyTypedArray"

export interface AsymmetricMutex {
    /** 32-bit starting position of the part allocated to this mutex in the buffer. */
    BUFFER_START: number
    /**
     * The empty field value of this instance (cannot be changed after initialization). In the case of
     * AsymmetricIOMutex, this will reflect whatever value was set to AsymmetricIOMutex.EMPTY_FIELD at the time
     * this mutex was initialized.
     */
    EMPTY_FIELD: number
    /** This Mutex's output buffers and field descriptions to be used in a coupled Mutex as input buffers. */
    propertiesForCoupling: MutexExportProperties
    /** Typed number array views of the output data arrays. */
    outputDataViews: (TypedNumberArray | null)[]
    /** An array of objects holding the output buffer meta field properties. */
    outputMetaFields: MutexMetaField[]
    /** A typed array view holding the output buffer metadata. */
    outputMetaView: TypedNumberArray | null
    /** The total 32-bit length of this buffer. */
    totalLength: number
    /**
     * The SharedArrayBuffer holding the write lock state of this mutex.
     * The lock value itself is stored at IOMutex.LOCK_POS index of an Int32Array view of this buffer.
     * @example
     * const bytePos = (M.BUFFER_START + IOMutex.LOCK_POS)*4 // Convert 32-bit index to byte index
     * const lockView = new Int32Array(M.writelockBuffer, bytePos, IOMutex.LOCK_LENGTH)
     */
    writeLockBuffer: SharedArrayBuffer | null
    /**
     * Execute the given function with the buffer locked for the appropriate operation.
     * Will wait for the buffer to be available and unlock the buffer once the function
     * has been executed.
     *
     * @param scope - Mutex scope.
     * @param mode - Mode of operation.
     * @param f - The function to execute.
     */
    executeWithLock: (scope: MutexScope, mode: MutexMode, f: () => any) => void
    /**
     * Get the value stored in `field` in all or some of the data arrays.
     * @param field - Name of the field.
     * @param indices - Array indices to include (defaults to all).
     * @returns An array of values (null if the value for given index could not be retrieved) for each requested data array.
     */
    getDataFieldValue (field: string, indices?: number | number[]): Promise<(number|TypedNumberArray|null)[]>
    /**
     * Get the value stored in the given meta `field`.
     * @param field - Name of the meta field.
     * @returns Value or null if an error occurred.
     */
    getMetaFieldValue (field: string): Promise<number|null>
    /**
     * Initialize the mutex using the given `buffer`.
     * @param buffer - Buffer for this mutex.
     * @param startPosition - Optional 32-bit start position of this mutex within the buffer (defaults to zero).
     * @return Success (true/false)
     */
    initialize (buffer: SharedArrayBuffer, startPosition?: number): boolean
    /**
     * Check if the given typed array constructor is allowed.
     * @param constructor - Constructor of the typed array.
     * @returns true/false
     */
    isAllowedTypeConstructor (constructor: TypedNumberArrayConstructor<SharedArrayBuffer>): boolean
    /**
     * Check if the shared array is available for the given mode of operation.
     * @param scope - Mutex scope to use.
     * @param mode - Mode of operation.
     * @returns True/false.
     */
    isAvailable (scope: MutexScope, mode: MutexMode): boolean
    /**
     * Add a lock for the shared array buffer for the given mode. Will wait until the
     * buffer is available for the appropriate operation.
     * @param scope - Mutex scope.
     * @param mode - Mode of operation.
     * @param maxTries - Number of times the mutex will try again (minus the first try) if the buffer is locked. Each try lasts a maximum of 100 ms (optional, default 50 tries = 5 seconds).
     * @return Success of locking as true/false.
     */
    lock (scope: MutexScope, mode: MutexMode, maxTries?: number): Promise<boolean>
    /**
     * Resolve once the shared array is available for the given mode of operation.
     * @param scope - Mutex scope.
     * @param mode - Mode of operation.
     * @returns Promise that resolves when the mode of operation is available.
     */
    onceAvailable (scope: MutexScope, mode: MutexMode): Promise<boolean>
    /**
     * Remove all references to buffers in this mutex.
     *
     * **WARNING**: This mutex will irreversibly lose the ability to access
     *            data contained in the released buffers.
     */
    releaseBuffers (): void
    /**
     * Set a new position for the buffer start.
     *
     * **IMPORTANT**: Any other mutex using this mutex as its input will not implicitly inherit
     * this change! It will refer to the old buffer positions until `setInputMutexProperties()`
     * has been called with the updated properties from this mutex.
     *
     * @param position - Position as a 32-bit array index.
     * @xample
     */
    setBufferStartPosition (position: number): boolean
    /**
     * Set new data to the data arrays in this mutex. Both the new data and the
     * existing data array views must have the same bytes per element.
     * @param arrayIdx - Starting index of the list of data arrays.
     * @param dataArrays - Data array or list of arrays to use as new data.
     * @param dataIdx - Optional starting index within the data array (default 0).
     * @returns Success (true/false)
     */
    setData (arrayIdx: number, dataArrays: TypedNumberArray|TypedNumberArray[], dataIdx?: number): Promise<boolean>
    /**
     * Set data arrays to current buffer.
     * @param dataArrays - Arrays to set as new data arrays (empty array will remove all current arrays).
     * @returns Success (true/false)
     */
    setDataArrays (dataArrays?: { constructor: TypedNumberArrayConstructor<SharedArrayBuffer>, length: number }[]): boolean
    /**
     * Set data field descriptors or reset their positions if meta fields have changed.
     * @param fields - Optional new fields (if empty, will recalculate positions of existing fields).
     * @returns Success (true/false)
     */
    setDataFields (fields?: MutexMetaField[]): boolean
    /**
     * Set the `value` to the given `field` in all or some of the data arrays.
     * @param field - Name of the field.
     * @param value - The value to set.
     * @param indices - Indices of the data arrays to set the value to (defaults to all).
     * @returns Success (true/false)
     */
    setDataFieldValue (field: string, value: number, indices?: number[]): Promise<boolean>
    /**
     * Use coupling properties from another mutex to use it as an input for this mutex.
     * @param input - Properties of the input mutex.
     * @returns Success (true/false)
     */
    setInputMutexProperties (input: MutexExportProperties): boolean
    /**
     * Set log printing threshold.
     */
    setLogLevel: typeof Log.setPrintThreshold
    /**
     * Set the given fields as meta information fields.
     * @param fields - Meta fields to use.
     * @returns Success (true/false)
     */
    setMetaFields (fields: MutexMetaField[]): boolean
    /**
     * Set a new `value` to a meta info `field`.
     * @param field - Name of the field.
     * @param value - The new value to set.
     * @returns Success (true/false)
     */
    setMetaFieldValue (field: string, value: number): Promise<boolean>
    /**
     * Remove a lock for the shared array buffer for the given mode.
     * @param scope - Mutex scope.
     * @param mode - Mode of operation.
     * @return Whether the buffer was unlocked or not (will also return false if there are other inputs left)
     */
    unlock (scope: MutexScope, mode: MutexMode): boolean
    /**
     * Wait for a meta or data field to update and return the new value.
     * @param fieldType - Type of the field ('data' or 'meta').
     * @param fieldIndex - Index of the the data/meta field.
     * @param dataIndex - Index of the data buffer (only if fieldType is 'data', defaults to last data buffer).
     * @returns A promise that will resolve with the new number at the given field or reject on error.
     */
    waitForFieldUpdate (fieldType: 'data' | 'meta', fieldIndex: number, dataIndex?: number): Promise<number>
}
/**
 * A part of memory buffer containing either a single data array or set of related data arrays.
 */
export type ArrayBufferPart = {
    /** The shared array buffer containing this array buffer part. */
    buffer: SharedArrayBuffer | null
    /** Properties of the metadata describing the data managed by this mutex. */
    fields: MutexMetaField[]
    /** Total length of this buffer part. */
    length: number
    /** 32-bit position of this array part (from the part start). */
    position: number
}
/**
 * Array buffer part containing a single data array.
 */
export type ArrayBufferEntry = ArrayBufferPart&{
    view: TypedNumberArray | null
}
/**
 * Properties of a single array in a list of array buffer arrays.
 */
export type ArrayBufferArray = {
    /** Array data type constructor. */
    constructor: TypedNumberArrayConstructor<SharedArrayBuffer>
    /** Length in array data units. */
    length: number
    /** 32-bit position of this array part (from the data part start). */
    position: number
    /** A constructed view of the array data, or null if no view is set. */
    view: TypedNumberArray | null
}
/**
 * Array buffer part containing a list of data arrays.
 */
export type ArrayBufferList = ArrayBufferPart&{
    /** Properties of each data array managed by the parent mutex. */
    arrays: ArrayBufferArray[]
}
/**
 * A set of exported mutex properties that are needed to use the source mutex as an
 * input in another mutex.
 */
export type MutexExportProperties = {
    /** Shared array buffer that contains the data for this mutex. */
    buffer: SharedArrayBuffer | null
    /** Starting position as array index of this mutex's data within the shared array buffer. */
    bufferStart: number,
    /** Properties of the data elements managed by this mutex. */
    data: ArrayBufferList | null
    /** Metadata properties describing the data managed by this mutex. */
    meta: ArrayBufferEntry
}
/**
 * Single metadata property contained in an array buffer.
 */
export type MutexMetaField = {
    /** Constructor for the metadata view. */
    constructor: TypedNumberArrayConstructor<SharedArrayBuffer>
    /** Length of this field in data units (i.e. number of array elements of a constructed view). */
    length: number
    /** Name of this metadata field. */
    name: string
    /** 32-bit position of this field. */
    position: number
    /** Constructed view of the metadata values or already parsed values as an array of numbers. */
    data?: number[] | TypedNumberArray
}
/** Data access mode (read or write). */
export type MutexMode = 'r' | 'w'
/** Accessed data scope (input or output). */
export type MutexScope = 'i' | 'o'

/**
 * Allowed typed number array types.
 * @remarks
 * Since Atomics operations only work with 32-bit integer arrays and array lengths must be devisible by the array
 * element length, smaller than 32-bit elements might cause problems and are not supported. 64-bit element arrays
 * may get support in the future.
 */
export type TypedNumberArray = Float32Array | Int32Array | Uint32Array
/**
 * Allowed typed number array constructor types.
 * @remarks
 * Since Atomics operations only work with 32-bit integer arrays and array lengths must be devisible by the array
 * element length, smaller than 32-bit elements might cause problems and are not supported. 64-bit element arrays
 * may get support in the future.
 */
// @ts-expect-error - Version 5.7 of TypeScript requires array buffer type for typed number arrays.
export type TypedNumberArrayConstructor<T extends ArrayBufferLike> = Float32ArrayConstructor<T> | Int32ArrayConstructor<T> | Uint32ArrayConstructor<T>
/**
 * A pseudo-type used as a reminder that mutexes are not allowed to modify the contents of their input arrays.
 */
export type ReadonlyTypedArray = ReadonlyInt32Array | ReadonlyFloat32Array | ReadonlyUint32Array
/* All number types up to 32 bit for reference
export type TypedNumberArray = Float32Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array
export type TypedNumberArrayConstructor = Float32ArrayConstructor |
                                          Int8ArrayConstructor | Int16ArrayConstructor | Int32ArrayConstructor |
                                          Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor

export type ReadonlyTypedArray = ReadonlyInt8Array | ReadonlyInt16Array | ReadonlyInt32Array | ReadonlyFloat32Array |
                                 ReadonlyUint8Array | ReadonlyUint16Array | ReadonlyUint32Array
*/
