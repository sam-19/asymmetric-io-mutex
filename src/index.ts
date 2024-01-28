/**
 * Asymmetric input-output mutex for processing shared memory arrays.
 * @package    asymmetric-io-mutex
 * @copyright  2024 Sampsa Lohi
 * @license    MIT
 */

import { EPS, MAX_SAFE_INTEGER, MIN_SAFE_INTEGER } from "@stdlib/constants-float32"
import Log from 'scoped-ts-log'
import {
    type ArrayBufferArray,
    type ArrayBufferEntry,
    type ArrayBufferList,
    type ArrayBufferPart,
    type AsymmetricMutex,
    type MutexExportProperties,
    type MutexMetaField,
    type MutexMode,
    type MutexScope,
    type ReadonlyTypedArray,
    type TypedNumberArray,
    type TypedNumberArrayConstructor
} from "./AsymmetricMutex"

const SCOPE = 'IOMutex'

/**
 * Returns a promise that resolves after the given time.
 * @param duration - Time to wait in milliseconds.
 * @returns Promise
 */
const sleep = async (duration: number): Promise<void> => {
    return new Promise<void>(resolve => setTimeout(resolve, duration))
}
export default class IOMutex implements AsymmetricMutex {

    /**
     * The EMPTY_FIELD value must be numerical since it is saved into the typed number array.
     * Its value can be set to a desired number, so it will not conflict with values used
     * for actual data. The value must be between the minimum and maximum safe integers that
     * can be stored in a 32-bit integer array.\
     * Default value is minimum safe integer (-16777215).
     * @param value - The new value to use as empty field (-16777215 - 16777215).
     * @remarks
     * Note that the new value will only affect mutexes initialized after the change.
     */
    static get EMPTY_FIELD (): number {
        return IOMutex._EMPTY_FIELD
    }
    static set EMPTY_FIELD (value: number) {
        if (value < MIN_SAFE_INTEGER) {
            Log.warn(`New empty field value ${value} is smaller than the minimum safe integer; ` +
                     `minimum safe integer will be used.`, SCOPE)
            value = MIN_SAFE_INTEGER
        }
        if (value > MAX_SAFE_INTEGER) {
            Log.warn(`New empty field value ${value} is larger than the maximum safe integer; ` +
                     `maximum safe integer will be used.`, SCOPE)
            value = MAX_SAFE_INTEGER
        }
        IOMutex._EMPTY_FIELD = value
    }

    /**
     * The 32-bit starting index of the meta field array.
     */
    static get META_START_POS (): number {
        return IOMutex.LOCK_POS + IOMutex.LOCK_LENGTH
    }

    /**
     * Compare two floating point numbers that have been read from a 32-bit
     * float array, factoring in precision error (epsilon).
     * @param float1 - 32-bit float #1.
     * @param float2 - 32-bit float #2.
     * @returns - True if equal (enough), false if not.
     */
    static floatsAreEqual (float1: number, float2: number): boolean {
        return (Math.abs(float1 - float2) < EPS)
    }

    /** 32-bit length of the lock element. */
    static readonly LOCK_LENGTH = 1
    /** 32-bit index of the buffer lock position. */
    static readonly LOCK_POS = 0
    /** Array index or value that hasn't been assigned yet. */
    static readonly UNASSIGNED_VALUE = -1
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

    /** Starting index (lock position) of the main buffer. */
    protected _BUFFER_START = 0

    /** Internal static empty field value. */
    protected static _EMPTY_FIELD = MIN_SAFE_INTEGER
    /** Empty field value as it was when this mutex was instantiated. */
    protected _EMPTY_FIELD: number

    /** The master buffer holding all of the data saved in this mutex. */
    protected _buffer: SharedArrayBuffer | null = null
    /** Properties of the data fields contained in the buffered read arrays. */
    protected _inputDataFields: MutexMetaField[] = []
    /** Views of the buffered input data arrays. */
    protected _inputDataViews: ReadonlyTypedArray[] = []
    /** View of the read lock. */
    protected _readLockView: Int32Array | null = null
    /** Properties of the input metadata array. */
    protected _inputMetaFields: MutexMetaField[] = []
    /** View of the input metadata array. */
    protected _inputMetaView: ReadonlyTypedArray | null = null
    /** Output data arrays. */
    protected _outputData: ArrayBufferList | null = null
    /** Total length of the output data fields (= position where the actual data starts). */
    protected _outputDataFieldsLen = 0
    /** Write side lock. */
    protected _writeLock: ArrayBufferPart&{ view: Int32Array | null } // Write lock must be Int32
    /** Output metadata array. */
    protected _outputMeta: ArrayBufferEntry

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
     *   coupledMutexProps: MutexExportProperties // Mutex fields to use as reference for shared buffers.
     * }
     * ```
     */
    constructor (
        metaFields?: MutexMetaField[],
        dataFields?: MutexMetaField[],
        coupledMutexProps?: MutexExportProperties,
    ) {
        // Set the current empty field value as this instances empty field
        this._EMPTY_FIELD = IOMutex.EMPTY_FIELD
        // Preserve room for one 32 bit integer (= 4 bytes) for lock values and the appropriate
        // amount of for metadata values.
        // The lock views must use the 32 bit integer, because Atomics.notify() is not compatible
        // bit the 8- or 16-bit types.
        this._writeLock = {
            buffer: null,
            fields: [],
            length: 1,
            position: 0,
            view: null,
        }
        this._outputMeta = {
            view: null,
            buffer: null,
            fields: [],
            length: 0,
            position: IOMutex.META_START_POS,
        }
        // Save possible constructors and initialize field properties
        if (metaFields) {
            this.setMetaFields(metaFields)
        }
        if (dataFields) {
            this.setDataFields(dataFields)
        }
        // Import buffers from the possible coupled output mutex
        if (coupledMutexProps?.buffer) {
            this.setInputMutexProperties(coupledMutexProps)
        }
    }

    get BUFFER_START (): number {
        return this._BUFFER_START
    }

    get EMPTY_FIELD (): number {
        return this._EMPTY_FIELD
    }

    get propertiesForCoupling (): MutexExportProperties {
        // Only clone the relevant properties.
        const props = {
            buffer: this._buffer,
            bufferStart: this.BUFFER_START,
            data: this._outputData ? {
                arrays: this._outputData.arrays.map(a => {
                    return {
                        constructor: a.constructor,
                        length: a.length,
                        position: a.position,
                        view: null // Don't clone the view that can contain large amounts of data
                    }
                }),
                buffer: null,
                fields: this._outputData.fields.map(f => {
                    return {
                        constructor: f.constructor,
                        length: f.length,
                        name: f.name,
                        position: f.position,
                    }
                }),
                length: this._outputData.length,
                position: this._outputData.position,
            } : null,
            meta: {
                buffer: null,
                fields: this._outputMeta.fields.map(f => {
                    return {
                        constructor: f.constructor,
                        length: f.length,
                        name: f.name,
                        position: f.position,
                    }
                }),
                length: this._outputMeta.length,
                position: this._outputMeta.position,
                view: null,
            }
        }
        return props
    }

    get outputDataViews (): (TypedNumberArray|null)[] {
        if (!this._outputData?.arrays) {
            return []
        }
        const views = this._outputData.arrays.map(a => a.view)
        return views
    }

    get outputMetaFields (): MutexMetaField[] {
        return this._outputMeta.fields
    }

    get outputMetaView (): TypedNumberArray|null {
        return this._outputMeta.view
    }

    get totalLength (): number {
        let totLen = IOMutex.META_START_POS + this._outputMeta.length
        totLen += this._outputData?.arrays.reduce((total, a) => total + a.length, 0) || 0
        return totLen
    }

    get writeLockBuffer (): SharedArrayBuffer|null {
        return this._writeLock.buffer
    }

    /////////////////////////////////////////////////////////////////////////
    //////                      INTERNAL METHODS                      ///////
    /////////////////////////////////////////////////////////////////////////

    /**
     * Get the properties of a data field.
     * Will return null if a field of the given name is not found, and as such
     * can be used to check if a field exists.
     * @param scope - Mutex scope to use.
     * @param fieldName - Name of the desired field.
     * @returns MutexMetaField or null if not found.
     */
    protected _getDataFieldProperties = (scope: MutexScope, fieldName: string): MutexMetaField|null => {
        // Select the mode-appropriate properties
        const dataFields = scope === IOMutex.MUTEX_SCOPE.INPUT
                                     ? this._inputDataFields
                                     : this._outputData?.fields || []
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
     * @returns Typed number array holding the field values or null on error.
     */
    protected _getDataFieldValue = async (scope: MutexScope, index: number, fieldName: string):
    Promise<TypedNumberArray|null> => {
        // Select the mode-appropriate properties
        const dataViews = scope === IOMutex.MUTEX_SCOPE.INPUT
                                    ? this._inputDataViews
                                    : this._outputData?.arrays.map(a => a.view).filter(v => v) as ReadonlyTypedArray[]
        const dataFields = scope === IOMutex.MUTEX_SCOPE.INPUT
                                     ? this._inputDataFields
                                     : this._outputData?.fields || []
        if (index < 0 || index >= dataViews.length) {
            Log.error(`Could not get ${fieldName} field value with an out of bound index ${index} (${this._inputDataViews.length} data buffers).`, SCOPE)
            return null
        }
        return this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, () => {
            for (const field of dataFields) {
                if (field.name === fieldName) {
                    const value = dataViews[index].subarray(field.position, field.position + field.length)
                    if (field.constructor.name === 'Int32Array') {
                        return value
                    } else {
                        return new field.constructor(value.buffer, value.byteOffset, value.byteLength/4)
                    }
                }
            }
            Log.error(`Could not find field ${fieldName} in input data.`, SCOPE)
            return null
        })
    }

    /**
     * Return the appropriate lock view for the given `scope`.
     * @param scope - Mutex scope to use.
     * @returns Buffer view as an Int32Array or null if the view is not set.
     */
    protected _getLockView = (scope: MutexScope): Int32Array|null => {
        return scope === IOMutex.MUTEX_SCOPE.INPUT
                         ? this._readLockView : this._writeLock.view
    }

    /**
     * Get the properties of a meta field.
     * Will return null if a field of the given name is not found, and as such
     * can be used to check if a field exists.
     * @param scope - Mutex scope to use.
     * @param fieldName - Name of the desired field.
     * @returns MutexMetaField or null if not found.
     */
    protected _getMetaFieldProperties = (scope: MutexScope, fieldName: string): MutexMetaField|null => {
        // Select the mode-appropriate properties
        const metaFields = scope === IOMutex.MUTEX_SCOPE.INPUT
                                     ? this._inputMetaFields
                                     : this._outputMeta.fields
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
     * @returns Typed number array containing the values, or null on error.
     */
    protected _getMetaFieldValue = async (scope: MutexScope, fieldName: string): Promise<TypedNumberArray|null> => {
        // Select the mode-appropriate properties
        const metaFields = scope === IOMutex.MUTEX_SCOPE.INPUT
                                     ? this._inputMetaFields
                                     : this._outputMeta.fields
        const metaView = scope === IOMutex.MUTEX_SCOPE.INPUT
                                   ? this._inputMetaView
                                   : this._outputMeta.view
        if (!metaView) {
            Log.error(`Cound not get meta field value; the meta buffer is not initialized.`, SCOPE)
            return null
        }
        return this.executeWithLock(scope, IOMutex.OPERATION_MODE.READ, () => {
            for (const field of metaFields) {
                if (field.name === fieldName) {
                    const value = metaView.subarray(field.position, field.position + field.length)
                    if (field.constructor.name === 'Int32Array') {
                        return value
                    } else {
                        return new field.constructor(value.buffer, value.byteOffset, value.byteLength/4)
                    }
                }
            }
            Log.error(`Could not find field ${fieldName} in input data.`, SCOPE)
            return null
        })
    }

    /**
     * Set a new value to a output data buffer field.
     * @param index - Data buffer index.
     * @param fieldName - Name of the field.
     * @param values - The desired values (must match the length of the data field).
     * @returns True on success, false on error.
     */
    protected _setOutputDataFieldValue = async (index: number, fieldName: string, ...values: number[]):
    Promise<boolean> => {
        return this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE, () => {
            if (!this._outputData || !this._buffer) {
                Log.error(`Could not set output data field value; the buffer has not been initialized.`, SCOPE)
                return false
            }
            const dataArray = this._outputData.arrays[index]
            if (index < 0 || !dataArray) {
                Log.error(`Could not output data field value with an out of bound index ${index} ` +
                          `(${this._outputData.arrays.length} data buffers).`, SCOPE)
                return false
            }
            for (const field of this._outputData.fields) {
                if (field.name === fieldName) {
                    if (values.length !== field.length) {
                        Log.error(`Could not set output data field value; size of the value was incorrect ` +
                                  `(${values.length} !== ${field.length}).`, SCOPE)
                        return false
                    }
                    if (!dataArray.view) {
                        Log.error(`Could not set output data field value; the array view has not been set.`, SCOPE)
                        return false
                    }
                    if (field.constructor.name === 'Int32Array') {
                        dataArray.view.set(values, field.position)
                    } else {
                        (new field.constructor(
                            dataArray.view.buffer,
                            dataArray.view.byteOffset,
                            dataArray.view.byteLength/4
                        )).set(values, field.position)
                    }
                    Atomics.notify(new Int32Array(this._buffer), dataArray.position + field.position)
                    return true
                }
            }
            Log.error(`Could not find field ${fieldName} in output data.`, SCOPE)
            return false
        })
    }

    /**
     * Set a new value to a output meta field.
     * @param fieldName - Name of the field.
     * @param values - The desired values (must match the length of the data field).
     * @returns True on success, false on error.
     */
    protected _setOutputMetaFieldValue = async (fieldName: string, ...values: number[]): Promise<boolean> => {
        return this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE, () => {
            if (!this._buffer) {
                Log.error(`Could not set output meta field value; the buffer has not been initialized.`, SCOPE)
                return false
            }
            if (!this._outputMeta.view) {
                Log.error(`Cound not set output meta field value; the meta view has not been set.`, SCOPE)
                return false
            }
            for (const field of this._outputMeta.fields) {
                if (field.name === fieldName) {
                    if (values.length !== field.length) {
                        Log.error(`Could not set output meta field value; size of the value was incorrect ` +
                                  `(${values.length} !== ${field.length}).`, SCOPE)
                        return false
                    }
                    if (values[0] === this.EMPTY_FIELD) {
                        Log.warn(`Output meta field value was set to the value reserved for empty field ` +
                                 `(${this.EMPTY_FIELD}), this may result in errors.`, SCOPE)
                    }
                    this._outputMeta.view.set(values, field.position)
                    if (field.constructor.name === 'Int32Array') {
                        this._outputMeta.view.set(values, field.position)
                    } else {
                        (new field.constructor(
                            this._outputMeta.view.buffer,
                            this._outputMeta.view.byteOffset,
                            this._outputMeta.view.byteLength/4
                        )).set(values, field.position)
                    }
                    Atomics.notify(new Int32Array(this._buffer), this._outputMeta.position + field.position)
                    return true
                }
            }
            Log.error(`Could not find field ${fieldName} in output data.`, SCOPE)
            return false
        })
    }

    /////////////////////////////////////////////////////////////////////////
    //////                       PUBLIC METHODS                       ///////
    /////////////////////////////////////////////////////////////////////////

    async executeWithLock (scope: MutexScope, mode: MutexMode, f: (() => any)): Promise<any> {
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
                if (mode === IOMutex.OPERATION_MODE.WRITE) {
                    Log.error(`Target buffer was not unlocked after a write operation.`, SCOPE)
                } else {
                    Log.debug(`Target buffer was not unlocked after a read operations, at least one other process ` +
                              `was left reading the buffer.`, SCOPE)
                }
            }
        }
        return returnValue
    }

    async getDataFieldValue (field: string, indices: number | number[] = []):
    Promise<(number|TypedNumberArray|null)[]> {
        if (!this._outputData || !this._buffer) {
            Log.error(`Cannot get data field value before output data has been initialized.`, SCOPE)
            return []
        }
        // Check arguments
        let fieldIdx = IOMutex.UNASSIGNED_VALUE
        for (let i=0; i< this._outputData.fields.length; i++) {
            if (this._outputData.fields[i].name === field) {
                fieldIdx = i
                break
            }
        }
        if (fieldIdx === IOMutex.UNASSIGNED_VALUE) {
            Log.error(`Could not get data field value, field name '${field}' was not found.`, SCOPE)
            return []
        }
        if (!Array.isArray(indices)) {
            indices = [indices]
        }
        const invalidIndices = [] as number[]
        for (let i=0; i<indices.length; i++) {
            if (indices[i] < 0 || indices[i] >= this._outputData.arrays.length) {
                Log.warn(`Data array index ${indices[i]} is out of bounds and was ignored.`, SCOPE)
                invalidIndices.push(indices.splice(i, 1)[0])
                i--
            }
        }
        if (invalidIndices.length && !indices.length) {
            Log.error(`List of indices given to 'getDataFieldValue' did not contain a single valid array index.`, SCOPE)
            return []
        }
        const values = [] as (number|TypedNumberArray|null)[]
        for (let i=0; i<this._outputData.arrays.length; i++) {
            if (indices.length && !indices.includes(i)) {
                continue
            }
            const value = await this._getDataFieldValue(IOMutex.MUTEX_SCOPE.OUTPUT, i, field)
            if (value === null) {
                Log.warn(`Value for field '${field}' in array ${i} could not be retrieved.`, SCOPE)
                values.push(null)
            } else {
                if (this._outputData.fields[fieldIdx].length === 1) {
                    values.push(value[0])
                } else {
                    values.push(value)
                }
            }
        }
        return values
    }

    async getMetaFieldValue (field: string): Promise<number|null> {
        if (!this._buffer) {
            Log.error(`Cannot get meta field value before output meta has been initialized.`, SCOPE)
            return null
        }
        // Check arguments
        let fieldIdx = IOMutex.UNASSIGNED_VALUE
        for (let i=0; i< this._outputMeta.fields.length; i++) {
            if (this._outputMeta.fields[i].name === field) {
                fieldIdx = i
                break
            }
        }
        if (fieldIdx === IOMutex.UNASSIGNED_VALUE) {
            Log.error(`Could not set meta field value, field name '${field}' was not found.`, SCOPE)
            return null
        }
        const value = await this._getMetaFieldValue(IOMutex.MUTEX_SCOPE.OUTPUT, field)
        return value !== null ? value[0] : value
    }

    initialize (buffer: SharedArrayBuffer, startPosition: number = 0): boolean {
        if (this._buffer) {
            Log.error(`Cannot re-initialize an already initialized mutex.`, SCOPE)
            return false
        }
        if (startPosition >= 0) {
            this._BUFFER_START = startPosition
        }
        // Check that the buffer can hold all current field elements
        let endIndex = this._BUFFER_START + Math.max(
            ...this._outputMeta.fields.map(f => f.position + f.length)
        )
        if (this._outputData) {
            const fieldsLen = this._outputData.fields.reduce((total, f) => total + f.length, 0)
            endIndex += this._outputData.arrays.length*fieldsLen
        }
        if (buffer.byteLength < endIndex) {
            Log.error(`The given buffer is too small to contain current meta and data arrays (${buffer.byteLength} ` +
                      `vs ${endIndex}).`, SCOPE)
            return false
        }
        this._buffer = buffer
        this._writeLock.buffer = buffer
        this._writeLock.view = new Int32Array(buffer, (this.BUFFER_START + IOMutex.LOCK_POS)*4, 1)
        this._writeLock.view.set([0])
        // Set meta view
        if (this._outputMeta.fields.length) {
            this._outputMeta.view = new Int32Array(
                buffer,
                (this.BUFFER_START + IOMutex.META_START_POS)*4,
                this._outputMeta.length
            )
        }
        if (this._outputMeta.fields.length) {
            // Set meta field values as empty
            for (const field of this._outputMeta.fields) {
                const fieldPos = this.BUFFER_START + IOMutex.META_START_POS + field.position
                const view = new field.constructor(buffer, fieldPos*4, field.length)
                view[0] = this._EMPTY_FIELD
            }
        }
        return true
    }

    isAllowedTypeConstructor (constructor: TypedNumberArrayConstructor): boolean {
        if (constructor.BYTES_PER_ELEMENT !== 4) {
            // Since the lock buffer must use a 32-bit integer, also the other views' element
            // sizes must be 32-bit numbers (arrays cannot have fractional indices).
            return false
        }
        return true
    }

    isAvailable (scope: MutexScope, mode: MutexMode): boolean {
        const lockView = this._getLockView(scope)
        if (!lockView) {
            Log.error(`'isAvailable' method called before mutex was initialized.`, SCOPE)
            return false
        }
        const lockVal = Atomics.load(lockView, IOMutex.LOCK_POS)
        return (
            lockVal === IOMutex.UNLOCKED_VALUE ||
            (mode === IOMutex.OPERATION_MODE.READ && lockVal !== IOMutex.WRITE_LOCK_VALUE)
        )
    }

    async lock (scope: MutexScope, mode: MutexMode, maxTries = 50): Promise<boolean> {
        // This async construction may be futile now, but it'll be ready when Atomics.asyncLock()
        // is made available.
        return new Promise<boolean>(async (resolve) => {
            const input = (mode === IOMutex.OPERATION_MODE.READ)
            const lockView = this._getLockView(scope)
            if (!lockView) {
                Log.error(`Cannot lock the array before mutex is initialized.`, SCOPE)
                return false
            }
            let retries = 0
            const startTime = Date.now()
            while (retries < maxTries) {
                const curValue = Atomics.load(lockView, 0)
                // Multiple mutexes can access the same read-locked buffer as input, so check for that first
                if (input && curValue >= 0) {
                    if (
                        // We must do a compared exchange as another mutex may have already changed the value
                        Atomics.compareExchange(lockView, 0, curValue, curValue + IOMutex.READ_LOCK_VALUE)
                        === curValue
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
                    // Else, keep waiting for the lock to release (wait for 90 ms, sleep for 10 ms).
                    // TODO: Should there be a wait line for same operation lock attempts
                    //       (to avoid race conditions between same operation requests)?
                    const result = await Promise.all([
                        Atomics.wait(
                            lockView,
                            0,
                            input ? IOMutex.WRITE_LOCK_VALUE : Atomics.load(lockView, 0),
                            90
                        ),
                        sleep(10)
                    ])
                    // TODO: Check result for ok?
                }
                retries++
            }
            if (retries === maxTries) {
                Log.error(
                    `Maximum retries of locking operation reached in ${Date.now() - startTime} ms, aborting.`,
                SCOPE)
                resolve(false)
            }
        })
    }

    async onceAvailable (scope: MutexScope, mode: MutexMode): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const input = (mode === IOMutex.OPERATION_MODE.READ)
            const lockView = this._getLockView(scope)
            if (!lockView) {
                Log.error(`'onceAvailable' method called before mutex was initialized.`, SCOPE)
                resolve(false)
                return
            }
            while (true) {
                const prevValue = Atomics.load(lockView, 0)
                // Check if the buffer is unlocked
                if (
                    prevValue === IOMutex.UNLOCKED_VALUE ||
                    input && prevValue > 0
                ) {
                    resolve(true)
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

    releaseBuffers () {
        this._inputDataFields.splice(0)
        this._inputDataViews.splice(0)
        this._inputMetaView = null
        this._outputMeta.view = null
        this._outputMeta.length = 0
        this._outputMeta.position = IOMutex.UNASSIGNED_VALUE
        this._outputMeta.fields.splice(0)
        this._outputMeta.buffer = null
        if (this._outputData) {
            for (const arr of this._outputData.arrays) {
                arr.view = null
            }
            this._outputData.arrays.splice(0)
            this._outputData.fields.splice(0)
            this._outputData.buffer = null
        }
        this._readLockView = null
        this._writeLock.view = null
        this._writeLock.buffer = null
        this._buffer = null
    }

    setBufferStartPosition (position: number): boolean {
        if (!this._buffer) {
            Log.error(`Cannot set buffer start position, buffer has not been initialized.`, SCOPE)
            return false
        }
        if ((position + this.totalLength)*4 > this._buffer.byteLength) {
            Log.error(`Cannot set buffer start position; current data would overflow remaining buffer.`, SCOPE)
            return false
        }
        this._BUFFER_START = position
        // Set array lock view
        this._writeLock.view = new Int32Array(
            this._buffer, this.BUFFER_START + IOMutex.LOCK_POS, IOMutex.LOCK_LENGTH
        )
        // Set meta array position
        if (this._outputMeta.view) {
            const viewPos = this.BUFFER_START + IOMutex.META_START_POS
            this._outputMeta.view = new Int32Array(
                this._buffer, viewPos*4, this._outputMeta.length,
            )
        }
        // Set data array positions
        if (this._outputData) {
            for (const array of this._outputData.arrays) {
                if (array.view) {
                    const viewPos = this.BUFFER_START + array.position
                    array.view = new array.constructor(
                        this._buffer, viewPos*4, array.length,
                    )
                }
            }
        }
        return true
    }

    async setData (arrayIdx: number, dataArrays: TypedNumberArray|TypedNumberArray[], dataIdx = 0): Promise<boolean> {
        // Set new data arrays
        return this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE, () => {
            if (!this._outputData) {
                Log.error(`Cannot set data, the arrays have not been intialized yet.`, SCOPE)
                return false
            }
            if (arrayIdx < 0 || arrayIdx >= this._outputData.arrays.length) {
                Log.error(`Cannot set data, the arrays have not been intialized yet.`, SCOPE)
                return false
            }
            if (Array.isArray(dataArrays) && dataArrays.length + dataIdx > this._outputData.arrays.length) {
                Log.error(`The number of data arrays (${dataArrays.length}) starting from index ${dataIdx} exceeds ` +
                          `existing number of arrays (${this._outputData.arrays.length}) and will be truncated.`,
                        SCOPE)
                dataArrays.splice(this._outputData.arrays.length - arrayIdx)
            }
            // Convert single data array to use with for()
            if (!Array.isArray(dataArrays)) {
                dataArrays = [dataArrays]
            }
            for (const data of dataArrays) {
                if (!data.length) {
                    continue // Don't process empty entries
                }
                const view = this._outputData.arrays[arrayIdx].view
                if (!view) {
                    Log.error(`Cannot set data to array ${arrayIdx}, the view has not been set.`, SCOPE)
                    continue
                }
                if (view.BYTES_PER_ELEMENT !== data.BYTES_PER_ELEMENT) {
                    Log.error(`Cannot set data to array ${arrayIdx}, bytes per element of the data and the view are ` +
                              `incompatible (${view.BYTES_PER_ELEMENT} vs ${data.BYTES_PER_ELEMENT}).`, SCOPE)
                    continue
                }
                if (!dataIdx && view.length - this._outputDataFieldsLen > data.length) {
                    Log.debug(`New data is shorter than the data array length; end of the array is not updated.`, SCOPE)
                }
                if (view.length - this._outputDataFieldsLen < data.length + dataIdx) {
                    Log.warn(`New data is longer than the data array length; end of the new data is truncated.`, SCOPE)
                    view.set(
                        data.subarray(0, view.length - this._outputDataFieldsLen - dataIdx),
                        this._outputDataFieldsLen + dataIdx
                    )
                } else {
                    view.set(data, this._outputDataFieldsLen + dataIdx)
                }
                arrayIdx++
            }
            return true
        })
    }

    setDataArrays (dataArrays: { constructor: TypedNumberArrayConstructor, length: number }[] = []): boolean {
        if (!this._buffer) {
            Log.error(`Cannot set data arrays before main buffer has been initialized.`, SCOPE)
            return false
        }
        if (!this._outputData) {
            Log.error(`Cannot set data arrays before output data properties have been initialized.`, SCOPE)
            return false
        }
        // Check that we have enough buffer for the arrays
        let totalLen = IOMutex.META_START_POS + this._outputMeta.length
        totalLen += dataArrays.reduce((total, a) => { return total + this._outputDataFieldsLen + a.length }, 0)
        if ((this.BUFFER_START + totalLen)*4 > this._buffer.byteLength) {
            Log.error(`Cannot set data arrays, remaining buffer cannot accommodate the data.`, SCOPE)
            return false
        }
        // Reset old arrays
        if (this._outputData.arrays) {
            for (const array of this._outputData.arrays.splice(0)) {
                array.view = null
            }
        }
        // Keep track of array starting position
        let arrayPos = IOMutex.META_START_POS + this._outputMeta.length
        for (const array of dataArrays) {
            this._outputData.arrays.push({
                constructor: array.constructor,
                length: this._outputDataFieldsLen + array.length,
                position: arrayPos,
                view: new array.constructor(
                    this._buffer,
                    (this.BUFFER_START + arrayPos)*4,
                    this._outputDataFieldsLen + array.length
                )
            })
            // Add the length of data fields and the main data array
            arrayPos += this._outputDataFieldsLen + array.length
        }
        return true
    }

    setDataFields (fields?: MutexMetaField[]): boolean {
        if (!this._outputMeta) {
            Log.error(`Cannot set data fields before meta fields are set.`, SCOPE)
            return false
        }
        if (!fields) {
            if (!this._outputData?.fields) {
                Log.error(`Cannot reset data fields that have not been initialized yet.`, SCOPE)
                return false
            }
            fields = this._outputData.fields
        } else {
            let fieldsLen = 0
            for (const f of fields) {
                if (!this.isAllowedTypeConstructor(f.constructor)) {
                    Log.error(`Data view constructor must use either an 8-bit, 16-bit or 32-bit element size.`, SCOPE)
                    return false
                }
                fieldsLen += f.length
            }
            this._outputDataFieldsLen = fieldsLen
            if (!this._outputData) {
                // Initialize data fields property
                this._outputData = {
                    arrays: [],
                    buffer: null,
                    fields: fields,
                    length: fieldsLen,
                    position: IOMutex.META_START_POS + this._outputMeta.length,
                }
            } else {
                if (this._buffer) {
                    // Check that we have enough buffer space for the new fields
                    let totalLen = IOMutex.META_START_POS + this._outputMeta.length
                    totalLen += this._outputData?.arrays.reduce(
                        (total, a) => { return total + this._outputDataFieldsLen + a.length }, 0
                    ) || 0
                    if ((this.BUFFER_START + totalLen)*4 > this._buffer.byteLength) {
                        Log.error(`Cannot set data fields, remaining buffer cannot accommodate the data.`, SCOPE)
                        return false
                    }
                }
                // Set field values
                this._outputData.fields = fields
            }
        }
        // Set field positions
        let fieldPos = 0
        for (const field of this._outputData.fields) {
            if (field.position === IOMutex.UNASSIGNED_VALUE) {
                field.position = fieldPos
            }
            fieldPos += field.length
        }
        // Set possible data array positions
        const dataPos = this.BUFFER_START + IOMutex.META_START_POS + this._outputMeta.length
        let arrayPos = 0
        for (const array of this._outputData.arrays) {
            if (this._buffer) {
                array.position = arrayPos
                const viewPos = dataPos + array.position
                array.view = new array.constructor(this._buffer, viewPos*4, array.length)
                arrayPos += fieldPos + array.length
            }
        }
        this._outputData.length = arrayPos
        return true
    }

    async setDataFieldValue (field: string, value: number, indices: number[] = []): Promise<boolean> {
        if (!this._outputData || !this._buffer) {
            Log.error(`Cannot set data field value before output data has been initialized.`, SCOPE)
            return false
        }
        // Check arguments
        let fieldIdx = IOMutex.UNASSIGNED_VALUE
        for (let i=0; i< this._outputData.fields.length; i++) {
            if (this._outputData.fields[i].name === field) {
                fieldIdx = i
                break
            }
        }
        if (fieldIdx === IOMutex.UNASSIGNED_VALUE) {
            Log.error(`Could not set data field value, field name '${field}' was not found.`, SCOPE)
            return false
        }
        const invalidIndices = [] as number[]
        for (let i=0; i<indices.length; i++) {
            if (indices[i] < 0 || indices[i] >= this._outputData.arrays.length) {
                Log.warn(`Data array index ${indices[i]} is out of bounds and was ignored.`, SCOPE)
                invalidIndices.push(indices.splice(i, 1)[0])
                i--
            }
        }
        if (invalidIndices.length && !indices.length) {
            Log.error(`List of indices given to 'setDataFieldValue' did not contain a single valid array index, ` +
                      `no field values were set.`, SCOPE)
            return false
        }
        let allSuccess = true
        for (let i=0; i<this._outputData.arrays.length; i++) {
            if (indices.length && !indices.includes(i)) {
                continue
            }
            const success = this._setOutputDataFieldValue(i, field, value)
            if (!success && allSuccess) {
                allSuccess = false
            }
        }
        return allSuccess
    }

    setInputMutexProperties (input: MutexExportProperties): boolean {
        if (!input.buffer) {
            // Cannot construct views without a buffer
            Log.error(`Could not set input mutex properties without an input buffer.`, SCOPE)
            return false
        }
        // We use the write lock of the connected mutex as our read lock
        this._readLockView = new Int32Array(
            input.buffer,
            (input.bufferStart + IOMutex.LOCK_POS)*4,
            IOMutex.LOCK_LENGTH
        )
        // Coupled meta
        for (const field of input.meta.fields) {
            this._inputMetaFields.push(field)
        }
        this._inputMetaView = input.meta.position !== IOMutex.UNASSIGNED_VALUE && input.meta.length
                              ? new Int32Array(
                                        input.buffer,
                                        (input.bufferStart + input.meta.position)*4,
                                        input.meta.length
                                    )
                              : null
        // Coupled data
        if (input.data) {
            // Data fields are the same in each item
            for (const field of input.data.fields) {
                this._inputDataFields.push(field)
            }
            for (let i=0; i<input.data.arrays.length; i++) {
                const dataArray = input.data.arrays[i]
                if (dataArray.position !== IOMutex.UNASSIGNED_VALUE) {
                    this._inputDataViews[i] = new dataArray.constructor(
                        input.buffer, (input.bufferStart  + dataArray.position)*4, dataArray.length
                    )
                }
            }
        }
        return true
    }

    setLogLevel = Log.setPrintThreshold

    setMetaFields (fields: MutexMetaField[]): boolean {
        let metaLen = 0
        for (const f of fields) {
            if (!this.isAllowedTypeConstructor(f.constructor)) {
                Log.error(`Each meta field must use either an 8-bit, 16-bit or 32-bit element size.`, SCOPE)
                return false
            }
            metaLen += f.length
        }
        if (this._buffer) {
            // Check that we have enough buffer space for the new fields
            let totalLen = IOMutex.META_START_POS + metaLen
            totalLen += this._outputData?.arrays.reduce(
                (total, a) => { return total + this._outputDataFieldsLen + a.length }, 0
            ) || 0
            if ((this.BUFFER_START + totalLen)*4 > this._buffer.byteLength) {
                Log.error(`Cannot set meta fields, remaining buffer cannot accommodate the data.`, SCOPE)
                return false
            }
        }
        this._outputMeta.fields = fields
        this._outputMeta.length = metaLen
        if (this._buffer) {
            this._outputMeta.view = new Int32Array(this._buffer, (IOMutex.META_START_POS)*4, metaLen)
        }
        if (this._outputData?.fields) {
            // Correct data field positions to reflect the new meta fields
            this.setDataFields()
        }
        return true
    }

    async setMetaFieldValue (field: string, value: number): Promise<boolean> {
        if (!this._buffer) {
            Log.error(`Cannot set meta field value before output meta has been initialized.`, SCOPE)
            return false
        }
        // Check arguments
        let fieldIdx = IOMutex.UNASSIGNED_VALUE
        for (let i=0; i< this._outputMeta.fields.length; i++) {
            if (this._outputMeta.fields[i].name === field) {
                fieldIdx = i
                break
            }
        }
        if (fieldIdx === IOMutex.UNASSIGNED_VALUE) {
            Log.error(`Could not set meta field value, field name '${field}' was not found.`, SCOPE)
            return false
        }
        const success = await this._setOutputMetaFieldValue(field, value)
        return success
    }

    unlock (scope: MutexScope, mode: MutexMode): boolean {
        const input = (mode === IOMutex.OPERATION_MODE.READ)
        const lockView = this._getLockView(scope)
        if (!lockView) {
            Log.error(`'unlock' method called before mutex was initialized.`, SCOPE)
            return false
        }
        const curValue = Atomics.load(lockView, 0)
        // Check if this is an input mutex and remove this mutex from the read counter
        this._lockScope[scope][mode] = false
        if (input) {
            const prevReaders = Atomics.sub(lockView, 0, IOMutex.READ_LOCK_VALUE)
            if (prevReaders <= 0) {
                // This should not happen unless there is a bug somewhere
                Atomics.store(lockView, 0, 0)
                Log.error(`Unlock operation substracted read lock count below zero.`, SCOPE)
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
            Log.error(`Unlock operation called on an already unlocked buffer.`, SCOPE)
        }
        Atomics.notify(lockView, 0)
        return true
    }

    waitForFieldUpdate (fieldType: 'data' | 'meta', fieldIndex: number, dataIndex?: number): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            if (fieldIndex < 0) {
                reject(`Cannot wait for field update, given field index is less than zero.`)
                return
            }
            const waitForNewValue = (fieldArray: Int32Array, fieldIndex: number) => {
                if (Atomics.wait(fieldArray, fieldIndex, Atomics.load(fieldArray, fieldIndex), 5000) === 'timed-out') {
                    return null
                }
                return Atomics.load(fieldArray, fieldIndex)
            }
            if (fieldType === 'data') {
                if (!this._outputData || !this._buffer) {
                    reject(`Cannot wait for field update, data buffer has not been initialized.`)
                    return
                }
                if (dataIndex === undefined) {
                    // Data fields are updated sequentially, so monitor the last field in the array
                    dataIndex = this._outputData.arrays.length - 1
                }
                if (dataIndex < 0 || dataIndex >= this._outputData.arrays.length) {
                    reject(`Cannot wait for field update, given data array index is out of range.`)
                }
                if (fieldIndex >= this._outputData.fields.length) {
                    reject(`Cannot wait for field update, given field index exceeds the number of data fields.`)
                    return
                }
                const dataField = this._outputData.fields[fieldIndex]
                const dataArrayPos = this._outputData.arrays[dataIndex].position
                const value = waitForNewValue(
                                new Int32Array(this._buffer),
                                this.BUFFER_START + dataArrayPos + dataField.position
                              )
                if (value === null) {
                    reject (`Field update request timed out.`)
                } else {
                    resolve(value)
                }
            } else {
                if (!this._buffer) {
                    reject(`Cannot wait for field update, meta buffer has not been initialized.`)
                    return
                }
                if (!this._outputMeta.view || fieldIndex >= this._outputMeta.fields.length) {
                    reject(`Cannot wait for field update, meta view is not initialized or given field index exceeds ` +
                           `the number of meta fields.`)
                    return
                }
                const metaField = this._outputMeta.fields[fieldIndex]
                const value = waitForNewValue(new Int32Array(this._buffer), this.BUFFER_START + metaField.position)
                if (value === null) {
                    reject (`Field update request timed out.`)
                } else {
                    resolve(value)
                }
            }
        })
    }
}

export {
    ArrayBufferArray,
    ArrayBufferEntry,
    ArrayBufferList,
    ArrayBufferPart,
    AsymmetricMutex,
    IOMutex,
    MutexExportProperties,
    MutexMetaField,
    MutexMode,
    MutexScope,
}
