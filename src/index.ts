/**
 * Asymmetric input-output mutex for processing shared memory arrays.
 * @package    asymmetric-io-mutex
 * @copyright  2022 Sampsa Lohi
 * @license    MIT
 */

import { EPS, MAX_SAFE_INTEGER, MIN_SAFE_INTEGER } from "@stdlib/constants-float32"
import Log from 'scoped-ts-log'
import { AsymmetricMutex, MutexExportFields, MutexMetaField, MutexMode, MutexScope, TypedNumberArray, TypedNumberArrayConstructor } from "./AsymmetricMutex"

const SCOPE = 'IOMutex'

class IOMutex implements AsymmetricMutex {

    /**
     * Scope can be either of:
     * * `i` for input.
     * * `o` for output.
     */
    static readonly MUTEX_SCOPE = {
        INPUT: 'i' as MutexScope,
        OUTPUT: 'o' as MutexScope,
    }
    /**
     * Operation mode can be either of:
     * * `r` for read.
     * * `w` for write.
     */
    static readonly OPERATION_MODE = {
        READ: 'r' as MutexMode,
        WRITE: 'w' as MutexMode,
    }
    /** Array value of read-locked buffer. */
    static readonly READ_LOCK_VALUE = 1
    /** Array value of unlocked buffer. */
    static readonly UNLOCKED_VALUE = 0
    /** Array value of output-locked buffer. */
    static readonly WRITE_LOCK_VALUE = -1

    /** Internal static empty field value. */
    protected static _EMPTY_FIELD = MIN_SAFE_INTEGER
    /** Empty field value as it was when this mutex was instantiated. */
    protected _EMPTY_FIELD: number

    /** Constructor used for the view of input data fields. */
    protected _inputDataViewConstructor?: TypedNumberArrayConstructor
    /** Constructor used for the view of input meta fields. */
    protected _inputMetaViewConstructor?: TypedNumberArrayConstructor
    /** Constructor used for the view of output data fields. */
    protected _outputDataViewConstructor: TypedNumberArrayConstructor
    /** Constructor used for the view of output meta fields. */
    protected _outputMetaViewConstructor: TypedNumberArrayConstructor

    /** Properties of the data fields contained in the buffered read arrays. */
    protected _inputDataFields: MutexMetaField[] = []
    /** Views of the buffered input data arrays. */
    protected _inputDataViews: TypedNumberArray[] = []
    /** View of the read lock. */
    protected _readLockView: Int32Array = new Int32Array()
    /** Properties of the input metadata array. */
    protected _inputMetaFields: MutexMetaField[] = []
    /** View of the input metadata array. */
    protected _inputMetaView: TypedNumberArray | null = null
    /** Raw buffers of output data arrays. */
    protected _outputDataBuffers: SharedArrayBuffer[] = []
    /** Properties of the data fields contained in the buffered output arrays. */
    protected _outputDataFields: MutexMetaField[] = []
    /** Views of the buffered output data arrays. */
    protected _outputDataViews: TypedNumberArray[] = []
    /** Raw buffer of the write lock. */
    protected _writeLockBuffer: SharedArrayBuffer
    /** View of the write lock. */
    protected _writeLockView: Int32Array
    /** Raw buffers of the output metadata array. */
    protected _outputMetaBuffer: SharedArrayBuffer | null = null
    /** Properties of the output metadata array. */
    protected _outputMetaFields: MutexMetaField[] = []
    /** View of the output metadata array. */
    protected _outputMetaView: TypedNumberArray | null = null

    /**
     * Are there active locks in place?
     * `[scope][mode]: boolean`
     */
    protected _lockScope = {
        [IOMutex.MUTEX_SCOPE.INPUT]: {
            [IOMutex.OPERATION_MODE.READ]: false,
            [IOMutex.OPERATION_MODE.WRITE]: false,
        },
        [IOMutex.MUTEX_SCOPE.OUTPUT]: {
            [IOMutex.OPERATION_MODE.READ]: false,
            [IOMutex.OPERATION_MODE.WRITE]: false,
        },
    }

    /**
     * Instantiate an asymmetric, shared memory mutex. All parameters are immutable after initialization.
     * If a coupled mutex is passed, its output buffers will be used as input buffers for this mutex.
     * @param metaFields - Metadata fields for this mutex.
     * @param metaViewConstructor - The view constructor to use to write into the meta buffer.
     * @param input - Optional input object:
     * ```
     * {
     *   dataViewConstructor: TypedNumberArrayConstructor // The view constructor to use to read the data buffers.
     *   metaViewConstructor: TypedNumberArrayConstructor // The view constructor to use to read the meta buffer.
     *   coupledMutexFields: MutexExportFields // Mutex fields to use as reference for shared buffers.
     * }
     * ```
     */
    constructor (
        metaFields: MutexMetaField[],
        metaViewConstructor: TypedNumberArrayConstructor,
        dataViewConstructor: TypedNumberArrayConstructor,
        input?: {
            metaViewConstructor: TypedNumberArrayConstructor,
            dataViewConstructor: TypedNumberArrayConstructor,
            coupledMutex: MutexExportFields
        }
    ) {
        // Set the current empty field value as this instances empty field
        this._EMPTY_FIELD = IOMutex.EMPTY_FIELD
        // Preserve room for one 32 bit integer (= 4 bytes) for lock values and the appropriate
        // amount of for metadata values.
        // The lock views must use the 32 bit integer, because Atomics.notify() is not compatible
        // bit the 8- or 16-bit types.
        this._writeLockBuffer = new SharedArrayBuffer(4)
        this._writeLockView = new Int32Array(this._writeLockBuffer)
        // Save construcotr types
        this._outputMetaViewConstructor = metaViewConstructor
        this._outputDataViewConstructor = dataViewConstructor
        if (metaFields.length) {
            let metaLen = 0
            for (const field of metaFields) {
                this._outputMetaFields.push(field)
                // Add four bytes (32 bits) for each meta field length
                metaLen += metaViewConstructor.BYTES_PER_ELEMENT*field.length
            }
            this._outputMetaBuffer = new SharedArrayBuffer(metaLen)
            this._outputMetaView = new metaViewConstructor(this._outputMetaBuffer)
            // Set meta field values as empty
            for (const field of metaFields) {
                this._outputMetaView[field.position] = this._EMPTY_FIELD
            }
        }
        // Import buffers from the possible coupled output mutex
        if (input) {
            // We use the write lock of the connected mutex as our read lock
            this._readLockView = new Int32Array(input.coupledMutex.lockBuffer)
            // Save the input buffer view constructors
            this._inputDataViewConstructor = input.dataViewConstructor
            this._inputMetaViewConstructor = input.metaViewConstructor
            // Coupled meta fields
            this._inputMetaView = input.coupledMutex.metaBuffer
                                  ? new input.metaViewConstructor(input.coupledMutex.metaBuffer)
                                  : null
            for (const field of input.coupledMutex.metaFields) {
                this._inputMetaFields.push(field)
            }
            // Coupled data buffers.
            for (const field of input.coupledMutex.dataFields) {
                this._inputDataFields.push(field)
            }
            for (let i=0; i<input.coupledMutex.dataBuffers.length; i++) {
                this._inputDataViews[i] = new input.dataViewConstructor(input.coupledMutex.dataBuffers[i])
            }
        }
    }

    /**
     * The EMPTY_FIELD value must be numerical since it is saved into the typed number array.
     * Its value can be set to a desired number, so it will not conflict with values used
     * for actual data. The value must be between the minimum and maximum safe integers that
     * can be stored in a 32-bit (single precision) float array.\
     * Default value is minimum safe integer (-16777215).
     * @param value - The new value to use as empty field (-16777215 - 16777215).
     * @remarks
     * Note that the new value will only affect mutexes initialized after the change!
     */
    static get EMPTY_FIELD () {
        return IOMutex._EMPTY_FIELD
    }
    static set EMPTY_FIELD (value: number) {
        if (value < MIN_SAFE_INTEGER) {
            Log.warn(`New empty field value ${value} is smaller than the minimum safe integer; minimum safe integer will be used.`, SCOPE)
            value = MIN_SAFE_INTEGER
        }
        if (value > MAX_SAFE_INTEGER) {
            Log.warn(`New empty field value ${value} is larger than the maximum safe integer; maximum safe integer will be used.`, SCOPE)
            value = MAX_SAFE_INTEGER
        }
        IOMutex._EMPTY_FIELD = value
    }

    /**
     * The empty field value of this instance (cannot be changed after initialization).
     */
    get EMPTY_FIELD () {
        return this._EMPTY_FIELD
    }

    /**
     * The SharedArrayBuffer holding the write lock state of this Mutex.
     */
    get writeLockBuffer () {
        return this._writeLockBuffer
    }

    /**
     * The SharedArrayBuffer holding the output buffer meta field data.
     */
    get outputMetaBuffer () {
        return this._outputMetaBuffer
    }

    /**
     * The array of objects holding the output buffer meta fields.
     */
    get outputMetaFields () {
        return this._outputMetaFields
    }

    /**
     * Compare two floating point numbers that have been read from a 32-bit
     * float array, factoring in precision error (epsilon).
     * @param float1 - 32-bit float #1.
     * @param float2 - 32-bit float #2.
     * @returns - True if equal (enough), false if not.
     */
    static floatsAreEqual (float1: number, float2: number) {
        return (Math.abs(float1 - float2) < EPS)
    }

    /////////////////////////////////////////////////////////////////////////
    //////                      INTERNAL METHODS                      ///////
    /////////////////////////////////////////////////////////////////////////

    /**
     * Return the appropriate lock view for the given `scope`.
     * @param scope - Mutex scope to use.
     * @returns Buffer view as an Int32Array.
     */
    protected _getLockView = (scope: MutexScope) => {
        return scope === IOMutex.MUTEX_SCOPE.INPUT
                         ? this._readLockView : this._writeLockView
    }

    /**
     * Get the properties of a data field.
     * Will return null if a field of the given name is not found, and as such
     * can be used to check if a field exists.
     * @param scope - Mutex scope to use.
     * @param fieldName - Name of the desired field.
     * @returns MutexMetaField or null if not found.
     */
    protected _getDataFieldProperties = (scope: MutexScope, fieldName: string) => {
        // Select the mode-appropriate properties
        const dataFields = scope === IOMutex.MUTEX_SCOPE.INPUT
                                     ? this._inputDataFields
                                     : this._outputDataFields
        for (const field of dataFields) {
            if (field.name === fieldName) {
                return field
            }
        }
        return null
    }

    /**
     * Get the value of a data field.
     * @param scope - Mutex scope to use.
     * @param index - Index of the data buffer.
     * @param name - Name of the field.
     * @returns Float32Array holding the field values or null on error.
     */
    protected _getDataFieldValue = (scope: MutexScope, index: number, fieldName: string): TypedNumberArray | null => {
        // Select the mode-appropriate properties
        const dataViews = scope === IOMutex.MUTEX_SCOPE.INPUT
                                    ? this._inputDataViews
                                    : this._outputDataViews
        const dataFields = scope === IOMutex.MUTEX_SCOPE.INPUT
                                     ? this._inputDataFields
                                     : this._outputDataFields
        if (index < 0 || index >= dataViews.length) {
            Log.error(`Could not get ${fieldName} field value with an out of bound index ${index} (${this._inputDataViews.length} data buffers).`, SCOPE)
            return null
        }
        for (const field of dataFields) {
            if (field.name === fieldName) {
                return dataViews[index].subarray(field.position, field.position + field.length)
            }
        }
        Log.error(`Could not find field ${fieldName} in input data.`, SCOPE)
        return null
    }

    /**
     * Get the properties of a meta field.
     * Will return null if a field of the given name is not found, and as such
     * can be used to check if a field exists.
     * @param scope - Mutex scope to use.
     * @param fieldName - Name of the desired field.
     * @returns MutexMetaField or null if not found.
     */
    protected _getMetaFieldProperties = (scope: MutexScope, fieldName: string) => {
        // Select the mode-appropriate properties
        const metaFields = scope === IOMutex.MUTEX_SCOPE.INPUT
                                     ? this._inputMetaFields
                                     : this._outputMetaFields
        for (const field of metaFields) {
            if (field.name === fieldName) {
                return {...field}
            }
        }
        return null
    }

    /**
     * Get the value of a meta field.
     * @param scope - Mutex scope to use.
     * @param fieldName - Name of the field.
     * @returns Float32Array containing the values, or null on error.
     */
    protected _getMetaFieldValue = (scope: MutexScope, fieldName: string) => {
        // Select the mode-appropriate properties
        const metaFields = scope === IOMutex.MUTEX_SCOPE.INPUT
                                     ? this._inputMetaFields
                                     : this._outputMetaFields
        const metaView = scope === IOMutex.MUTEX_SCOPE.INPUT
                                   ? this._inputMetaView
                                   : this._outputMetaView
        if (!metaView) {
            Log.error(`Cound not get meta field value; the meta buffer is not initialized.`, SCOPE)
            return null
        }
        for (const field of metaFields) {
            if (field.name === fieldName) {
                return metaView.subarray(field.position, field.position + field.length)
            }
        }
        Log.error(`Could not find field ${fieldName} in input data.`, SCOPE)
        return null
    }

    /**
     * Set a new value to a output data buffer field.
     * @param index - Data buffer index.
     * @param fieldName - Name of the field.
     * @param values - The desired values (must match the length of the data field).
     * @returns True on success, false on error.
     */
    protected _setOutputDataFieldValue = (index: number, fieldName: string, ...values: number[]) => {
        if (index < 0 || index >= this._outputDataViews.length) {
            Log.error(`Could not output data field value with an out of bound index ${index} (${this._outputDataViews.length} data buffers)!`, SCOPE)
            return false
        }
        for (const field of this._outputDataFields) {
            if (field.name === fieldName) {
                if (values.length !== field.length) {
                    Log.error(`Could not set output data field value; size of the value was incorrect (${values.length} !== ${field.length})!`, SCOPE)
                    return false
                }
                this._outputDataViews[index].set(values, field.position)
                if (this._outputDataBuffers[index]) {
                    Atomics.notify(new Int32Array(this._outputDataBuffers[index]), field.position)
                }
                return true
            }
        }
        Log.error(`Could not find field ${fieldName} in output data.`, SCOPE)
        return false
    }

    /**
     * Set a new value to a output meta field.
     * @param fieldName - Name of the field.
     * @param values - The desired values (must match the length of the data field).
     * @returns True on success, false on error.
     */
    protected _setOutputMetaFieldValue = (fieldName: string, ...values: number[]) => {
        if (!this._outputMetaView) {
            Log.error(`Cound not set output meta field value; the meta buffer has not bee initialized.`, SCOPE)
            return false
        }
        for (const field of this._outputMetaFields) {
            if (field.name === fieldName) {
                if (values.length !== field.length) {
                    Log.error(`Could not set output meta field value; size of the value was incorrect (${values.length} !== ${field.length})!`, SCOPE)
                    return false
                }
                if (values[0] === this.EMPTY_FIELD) {
                    Log.warn(`Output meta field value was set to the value reserved for empty field (${this.EMPTY_FIELD}), this may result in errors!`, SCOPE)
                }
                this._outputMetaView.set(values, field.position)
                if (this._outputMetaBuffer) {
                    Atomics.notify(new Int32Array(this._outputMetaBuffer), field.position)
                }
                return true
            }
        }
        Log.error(`Could not find field ${fieldName} in output data.`, SCOPE)
        return false
    }

    /////////////////////////////////////////////////////////////////////////
    //////                       PUBLIC METHODS                       ///////
    /////////////////////////////////////////////////////////////////////////

    /**
     * Execute the given function with the buffer locked for the appropriate operation.
     * Will wait for the buffer to be available and unlock the buffer once the function
     * has been executed.
     *
     * If the buffer is already locked for the given mode of opertion, it will not be
     * locked again.
     *
     * @param scope - Mutex scope.
     * @param mode - Mode of operation.
     * @param f - The function to execute.
     */
    async executeWithLock (scope: MutexScope, mode: MutexMode, f: (() => any)) {
        const requiresLock = !this._lockScope[scope][mode]
        if (requiresLock) {
            const lockSuccess = await this.lock(scope, mode)
            if (!lockSuccess) {
                Log.error(`Could not lock the target buffer for the operation.`, SCOPE)
                return
            }
        }
        const returnValue = f()
        if (requiresLock) {
            const unlockSuccess = this.unlock(scope, mode)
            if (!unlockSuccess) {
                Log.error(`Target buffer was not unlocked after the operation.`, SCOPE)
            }
        }
        return returnValue
    }

    /**
     * Export this Mutex's output buffers and field descriptions to be used in a coupled
     * Mutex as input buffers.
     * @returns Object containing this Mutex's output buffers and field descriptions.
     */
    exportForInputCouple () {
        return {
            dataBuffers: this._outputDataBuffers,
            dataFields: this._outputDataFields,
            lockBuffer: this._writeLockBuffer,
            metaBuffer: this._outputMetaBuffer,
            metaFields: this._outputMetaFields,
        }
    }

    /**
     * Check if the shared array is available for the given mode of operation.
     * @param scope - Mutex scope to use.
     * @param mode - Mode of operation.
     * @returns True/false.
     */
    isAvailable (scope: MutexScope, mode: MutexMode) {
        const lockVal = Atomics.load(this._getLockView(scope), 0)
        return (
            lockVal === IOMutex.UNLOCKED_VALUE ||
            (mode === IOMutex.OPERATION_MODE.READ && lockVal !== IOMutex.WRITE_LOCK_VALUE)
        )
    }

    /**
     * Add a lock for the shared array buffer for the given mode. Will wait until the
     * buffer is available for the appropriate operation.
     * @param scope - Mutex scope.
     * @param mode - Mode of operation.
     * @param maxTries - Number of times the mutex will try again if the buffer is locked.
     * @return Success of locking as true/false.
     */
    async lock (scope: MutexScope, mode: MutexMode, maxTries = 500) {
        // This async construction may be futile, but it'll be ready when Atomics.asyncLock()
        // is made available.
        return new Promise<boolean>((resolve) => {
            const input = (mode === IOMutex.OPERATION_MODE.READ)
            const lockView = this._getLockView(scope)
            let tries = 0
            while (tries < maxTries) {
                // Multiple inputs can access the same read-locked buffer, so check for that first
                if (input) {
                    const readCount = Atomics.load(lockView, 0)
                    if (
                        readCount >= 0 &&
                        // We must do a compared exchange as another mutex may have already changed the value
                        Atomics.compareExchange(lockView, 0, readCount, readCount + IOMutex.READ_LOCK_VALUE)
                        === readCount
                    ) {
                        this._lockScope[scope][mode] = true
                        Atomics.notify(lockView, 0)
                        resolve(true)
                        break
                    }
                } else if (
                    Atomics.compareExchange(lockView, 0, IOMutex.UNLOCKED_VALUE, IOMutex.WRITE_LOCK_VALUE)
                    === IOMutex.UNLOCKED_VALUE
                ) {
                    this._lockScope[scope][mode] = true
                    Atomics.notify(lockView, 0)
                    resolve(true)
                    break
                } else {
                    // Else, keep waiting for the lock to release
                    Atomics.wait(
                        lockView,
                        0,
                        input ? IOMutex.WRITE_LOCK_VALUE : Atomics.load(lockView, 0)
                    )
                }
                tries++
            }
            if (tries === maxTries) {
                resolve(false)
            }
        })
    }

    /**
     * Resolve once the shared array is available for the given mode of operation.
     * @param scope - Mutex scope.
     * @param mode - Mode of operation.
     * @returns Promise that resolves when the mode of operation is available.
     */
    async onceAvailable (scope: MutexScope, mode: MutexMode) {
        return new Promise<void>((resolve) => {
            const input = (mode === IOMutex.OPERATION_MODE.READ)
            const lockView = this._getLockView(scope)
            while (true) {
                const prevValue = Atomics.load(lockView, 0)
                // Check if the buffer is unlocked
                if (
                    prevValue === IOMutex.UNLOCKED_VALUE ||
                    input && prevValue > 0
                ) {
                    resolve()
                    return
                }
                // Else, keep waiting for the lock to release
                Atomics.wait(
                    lockView,
                    0,
                    prevValue
                )
            }
        })
    }

    /**
     * Remove a lock for the shared array buffer for the given mode.
     * @param scope - Mutex scope.
     * @param mode - Mode of operation.
     * @return Whether the buffer was unlocked or not (will also return false if there are other inputs left)
     */
    unlock (scope: MutexScope, mode: MutexMode) {
        const input = (mode === IOMutex.OPERATION_MODE.READ)
        const lockView = this._getLockView(scope)
        // Check if this is an input mutex and remove this mutex from the read counter
        this._lockScope[scope][mode] = false
        if (input) {
            const prevReaders = Atomics.sub(lockView, 0, IOMutex.READ_LOCK_VALUE)
            if (prevReaders <= 0) {
                // This should not happen unless there is a bug somewhere
                Atomics.store(lockView, 0, 0)
                Log.error(`Unlock operation substracted read lock count below zero!`, SCOPE)
            } else if (prevReaders !== IOMutex.READ_LOCK_VALUE) {
                // There are still some inputs left, so stop here
                Atomics.notify(lockView, 0)
                return false
            }
        } else if (
                // Try to unlock the buffer
                Atomics.compareExchange(lockView, 0, IOMutex.WRITE_LOCK_VALUE, IOMutex.UNLOCKED_VALUE)
                !== IOMutex.WRITE_LOCK_VALUE
        ) {
            // This should not happen unless there is a bug somewhere
            Log.error(`Unlock operation called on an already unlocked buffer!`, SCOPE)
        }
        Atomics.notify(lockView, 0)
        return true
    }

    /**
     * Wait for a meta or data field to update and return the new value.
     * @param fieldType - Type of the field ('data' or 'meta').
     * @param fieldIndex - Index of the field in the data/meta field buffer.
     * @param dataIndex - Index of the data buffer (only if fieldType is 'data', defaults to last data buffer).
     * @returns A promise that will resolve with the new number at the given field or reject on error.
     */
    waitForFieldUpdate (fieldType: 'data' | 'meta', fieldIndex: number, dataIndex?: number) {
        return new Promise<number>((resolve, reject) => {
            if (fieldIndex < 0) {
                reject(`Given field index is less than zero.`)
                return
            }
            const waitForNewValue = (fieldArray: Int32Array, fieldIndex: number) => {
                if (Atomics.wait(fieldArray, fieldIndex, Atomics.load(fieldArray, fieldIndex), 5000) === 'timed-out') {
                    return null
                }
                return Atomics.load(fieldArray, fieldIndex)
            }
            if (fieldType === 'data') {
                if (dataIndex === undefined) {
                    // Data fields are updated sequentially, so monitor the last field in the array
                    dataIndex = this._outputDataBuffers.length - 1
                }
                if (dataIndex < 0 || dataIndex >= this._outputDataBuffers.length) {
                    reject(`Given data buffer index is outside of data buffer array range.`)
                }
                if (fieldIndex >= this._outputDataFields.length) {
                    reject(`Given field index exceeds the number of data fields.`)
                    return
                }
                const value = waitForNewValue(new Int32Array(this._outputDataBuffers[dataIndex]), fieldIndex)
                if (value === null) {
                    reject (`Field update request timed out.`)
                } else {
                    resolve(value)
                }
            } else {
                if (!this._outputMetaView || fieldIndex >= this._outputMetaFields.length) {
                    reject(`Meta view is not initialized or given field index exceeds the number of meta fields.`)
                    return
                }
                const value = waitForNewValue(new Int32Array(this._outputMetaView), fieldIndex)
                if (value === null) {
                    reject (`Field update request timed out.`)
                } else {
                    resolve(value)
                }
            }
        })
    }
}

export default IOMutex
