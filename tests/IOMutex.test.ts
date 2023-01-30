/**
 * Asymmetric I/O Mutex tests.
 * @package    asymmetric-io-mutex
 * @copyright  2022 Sampsa Lohi
 * @license    MIT
 */

import { describe, expect, test } from '@jest/globals'
import IOMutex from '../src'
import { MutexExportProperties, MutexMetaField, TypedNumberArray, TypedNumberArrayConstructor } from '../src/AsymmetricMutex'

let expectError = false
// Catch console errors
beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation((message: any) => {
        // Do not show the message if expected
        if (!expectError) {
            console.log('Unexpected error:', message)
        }
    })
})
afterEach(() => {
    (console.error as any).mockClear()
})
afterAll(() => {
    (console.error as any).mockRestore()
})

// 2 kB buffer
const SAB = new SharedArrayBuffer(2*1024)
let BUFFER_POS = 0

// Create a test class that extends IOMutex
class TestMutex extends IOMutex {
    constructor (viewConstructor: TypedNumberArrayConstructor, metaFields: MutexMetaField[], dataFields: MutexMetaField[], dataArrays: TypedNumberArray[], dataLength: number, coupledMutexProps?: MutexExportProperties) {
        super(
            metaFields,
            undefined,
            coupledMutexProps
        )
        // Initialize buffer
        this.initialize(SAB, BUFFER_POS)
        BUFFER_POS += IOMutex.LOCK_LENGTH
        let metaLen = 0
        for (const f of metaFields) {
            if (f.data !== undefined) {
                this.setMetaFieldValue(f.name, f.data[0])
            }
            metaLen += f.length
        }
        let dataLen = 0
        this.setDataFields(dataFields)
        this.setDataArrays(dataArrays.map(a => { return { constructor: viewConstructor, length: dataLength } }))
        for (let i=0; i<dataArrays.length; i++) {
            for (let j=0; j<dataFields.length; j++) {
                const field = dataFields[j]
                if (field.data) {
                    this._setOutputDataFieldValue(i, field.name, field.data[0])
                }
                dataLen += field.length
            }
            this.setData(i, dataArrays[i])
            dataLen += dataArrays[i].length
        }
        BUFFER_POS += metaLen + dataLen
    }
    get inputDataViews () {
        return this._inputDataViews
    }
    get inputMetaView () {
        return this._inputMetaView
    }
    async writeData (data: TypedNumberArray[]) {
        return this.setData(0, data)
    }
}

describe('IOMutex tests', () => {
    test('Class is defined', () => {
        expect(IOMutex).toBeDefined()
    })
    test('Can construct with all 32-bit array types', async () => {
        const int32Mutex = new TestMutex(
            Int32Array,
            [
                {
                    constructor: Int32Array,
                    length: 1,
                    name: 'test',
                    position: 0
                }
            ],
            [
            ],
            [
                new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
            ],
            10
        )
        const uint32Mutex = new TestMutex(
            Uint32Array,
            [
                {
                    constructor: Uint32Array,
                    length: 1,
                    name: 'test',
                    position: 0
                }
            ],
            [
            ],
            [
                new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
            ],
            10
        )
        const float32Mutex = new TestMutex(
            Float32Array,
            [
                {
                    constructor: Float32Array,
                    length: 1,
                    name: 'test',
                    position: 0
                }
            ],
            [
            ],
            [
                new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
            ],
            10
        )
        const dataUint = await int32Mutex.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            return uint32Mutex.outputDataViews
        })
        expect(dataUint).toStrictEqual([new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])
        const dataInt = await int32Mutex.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            return int32Mutex.outputDataViews
        })
        expect(dataInt).toStrictEqual([new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])
        const dataFloat = await int32Mutex.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            return float32Mutex.outputDataViews
        })
        expect(dataFloat).toStrictEqual([new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])
    })
    const MTX_OUT = new TestMutex(
        Int32Array,
        [
            {
                constructor: Int32Array,
                length: 1,
                name: 'current-array',
                position: 0,
                data: [1]
            }
        ],
        [
            {
                constructor: Int32Array,
                length: 1,
                name: 'total-fields',
                position: 0,
                data: [10]
            },
            {
                constructor: Int32Array,
                length: 1,
                name: 'fields-loaded',
                position: 1,
                data: [0]
            },
        ],
        [
            new Int32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
            new Int32Array([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
            new Int32Array([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
        ],
        10
    )
    const MTX_IN = new TestMutex(
        Int32Array,
        [
            {
                constructor: Int32Array,
                length: 1,
                name: 'current-array',
                position: 0,
                data: [2]
            }
        ],
        [
            {
                constructor: Int32Array,
                length: 1,
                name: 'total-computations',
                position: 0,
                data: [10]
            },
            {
                constructor: Int32Array,
                length: 1,
                name: 'computations-done',
                position: 1,
                data: [0]
            },
        ],
        [
            new Int32Array(10)
        ],
        10,
        MTX_OUT.propertiesForCoupling
    )
    test('Can lock and unlock array', async () => {
        const lock = await MTX_OUT.lock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(lock).toStrictEqual(true)
        const unlock = MTX_OUT.unlock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(unlock).toStrictEqual(true)
    })
    test('Can read input and output meta fields', async () => {
        const inMeta = MTX_IN.inputMetaView
        expect((inMeta || [])[0]).toStrictEqual(1)
        const outMeta = await MTX_IN.getMetaFieldValue('current-array')
        expect(outMeta).toStrictEqual(2)
    })
    test('Can set meta field values', async () => {
        const setMeta = await MTX_OUT.setMetaFieldValue('current-array', 3)
        expect(setMeta).toStrictEqual(true)
        const metaVal = await MTX_OUT.getMetaFieldValue('current-array')
        expect(metaVal).toStrictEqual(3)
    })
    test('Can read output buffers', async () => {
        const dataOut = await MTX_OUT.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            return MTX_OUT.outputDataViews
        })
        expect(dataOut).toStrictEqual([
            new Int32Array([10, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
            new Int32Array([10, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
            new Int32Array([10, 0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
        ])
    })
    test('Can set output data field values', async () => {
        MTX_OUT.setDataFieldValue('fields-loaded', 1, [0])
        MTX_OUT.setDataFieldValue('fields-loaded', 2, [1])
        MTX_OUT.setDataFieldValue('fields-loaded', 3, [2])
        const dataOut = await MTX_OUT.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            return MTX_OUT.outputDataViews
        })
        expect(dataOut).toStrictEqual([
            new Int32Array([10, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
            new Int32Array([10, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
            new Int32Array([10, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
        ])
        MTX_OUT.setDataFieldValue('fields-loaded', 0)
    })
    test('Can write to output buffers', async () => {
        const write = await MTX_OUT.writeData([
            new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
            new Int32Array([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]),
            new Int32Array([0, 2, 4, 8, 16, 32, 64, 128, 256, 512]),
        ])
        expect(write).toStrictEqual(true)
    })
    test('Can read input buffers', async () => {
        const dataIn = await MTX_IN.executeWithLock(IOMutex.MUTEX_SCOPE.INPUT, IOMutex.OPERATION_MODE.READ, () => {
            return MTX_IN.inputDataViews
        })
        expect(dataIn).toStrictEqual([
            new Int32Array([10, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
            new Int32Array([10, 0, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18]),
            new Int32Array([10, 0, 0, 2, 4, 8, 16, 32, 64, 128, 256, 512]),
        ])
    })
    test('Cannot read input buffers locked by the output mutex', async () => {
        const writeLock = await MTX_OUT.lock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(writeLock).toStrictEqual(true)
        // Expect a maximum retries reached error here
        expectError = true
        const readLock = await MTX_IN.lock(IOMutex.MUTEX_SCOPE.INPUT, IOMutex.OPERATION_MODE.READ, 1)
        expect(readLock).toStrictEqual(false)
        expect(console.error).toHaveBeenCalled()
        expectError = false
        const writeUnlock = MTX_OUT.unlock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(writeUnlock).toStrictEqual(true)
    })
    test('Can execute other methods while waiting for lock', async () => {
        const writeLock = await MTX_OUT.lock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(writeLock).toStrictEqual(true)
        let resolveAllDone: null | (() => void) = null
        let gotLock: boolean | null = null
        let timeout = 0 as any
        const allDone = new Promise<void>(resolve => {
            resolveAllDone = resolve
            timeout = setTimeout(() => {
                if (resolveAllDone) {
                    resolveAllDone()
                    throw new Error(`Timeout reached when waiting for lock`)
                }
            }, 1000)
        })
        MTX_IN.lock(IOMutex.MUTEX_SCOPE.INPUT, IOMutex.OPERATION_MODE.READ).then((result) => {
            if (resolveAllDone) {
                gotLock = result
                resolveAllDone()
            }
        })
        const outArray = MTX_IN.outputDataViews[0]
        expect(outArray).toStrictEqual(new Int32Array([10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
        MTX_OUT.unlock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(gotLock).toStrictEqual(null)
        await allDone
        clearTimeout(timeout)
        expect(gotLock).toStrictEqual(true)
        MTX_IN.unlock(IOMutex.MUTEX_SCOPE.INPUT, IOMutex.OPERATION_MODE.READ)
    })
    test('Can change buffered data location', async () => {
        let mtxLen = 0
        mtxLen += IOMutex.LOCK_LENGTH + (MTX_OUT.outputMetaView?.length || 0)
        for (const view of MTX_OUT.outputDataViews) {
            mtxLen += (view?.length || 0)
        }
        const prevStart = MTX_OUT.BUFFER_START
        const newSAB = new Int32Array(SAB, 1024, mtxLen + MTX_OUT.BUFFER_START)
        newSAB.set((new Int32Array(SAB)).subarray(MTX_OUT.BUFFER_START, mtxLen))
        MTX_OUT.setBufferStartPosition(1024/4)
        new Int32Array(SAB, prevStart*4, mtxLen).fill(0)
        expect(MTX_OUT.BUFFER_START).toStrictEqual(1024/4)
        const dataOut = await MTX_OUT.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            return MTX_OUT.outputDataViews
        })
        expect(dataOut).toStrictEqual([
            new Int32Array([10, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
            new Int32Array([10, 0, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18]),
            new Int32Array([10, 0, 0, 2, 4, 8, 16, 32, 64, 128, 256, 512]),
        ])
        const coupleSuccess = MTX_IN.setInputMutexProperties(MTX_OUT.propertiesForCoupling)
        expect(coupleSuccess).toStrictEqual(true)
        const setSuccess = await MTX_OUT.setDataFieldValue('fields-loaded', 1, [0, 2])
        expect(setSuccess).toStrictEqual(true)
        const dataIn = await MTX_IN.executeWithLock(IOMutex.MUTEX_SCOPE.INPUT, IOMutex.OPERATION_MODE.READ, () => {
            return MTX_IN.inputDataViews
        })
        expect(dataIn).toStrictEqual([
            new Int32Array([10, 1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
            new Int32Array([10, 0, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18]),
            new Int32Array([10, 1, 0, 2, 4, 8, 16, 32, 64, 128, 256, 512]),
        ])
    })
})
