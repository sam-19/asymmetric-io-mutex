/**
 * Asymmetric IO Mutex tests.
 * @package    asymmetric-io-mutex
 * @copyright  2022 Sampsa Lohi
 * @license    MIT
 */

import { describe, expect, test } from '@jest/globals'
import IOMutex from '../src'
import { MutexExportFields, MutexMetaField, TypedNumberArray, TypedNumberArrayConstructor } from '../src/AsymmetricMutex'

const DATA_POS = 2
const RESULTS_POS = 2
// Create a test class that extends IOMutex
class TestMutex extends IOMutex {
    constructor (viewConstructor: TypedNumberArrayConstructor, metaFields: MutexMetaField[], dataFields: MutexMetaField[], dataArrays: TypedNumberArray[], coupledMutex?: MutexExportFields) {
        super(
            metaFields,
            viewConstructor,
            viewConstructor,
            coupledMutex ?
            {
                metaViewConstructor: viewConstructor,
                dataViewConstructor: viewConstructor,
                coupledMutex: coupledMutex
            } : undefined
        )
        this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE, () => {
            // Initialize buffers for each data field
            let dataLen = 0
            for (const field of dataFields) {
                this._outputDataFields.push({
                    name: field.name,
                    length: field.length,
                    position: field.position,
                })
                dataLen += field.length
            }
            for (let i=0; i<dataArrays.length; i++) {
                const sab = new SharedArrayBuffer(dataLen*viewConstructor.BYTES_PER_ELEMENT)
                this._outputDataBuffers.push(sab)
                const dataView = new viewConstructor(sab)
                for (let j=0; j<dataFields.length; j++) {
                    const field = dataFields[j]
                    if (field.data) {
                        dataView.set(field.data, field.position)
                    } else {
                        dataView.set(dataArrays[i], field.position)
                    }
                }
                this._outputDataViews.push(dataView)
            }
            for (const buf of (coupledMutex?.dataBuffers || [])) {
                this._inputDataViews.push(new viewConstructor(buf))
            }
        }).catch(e => {
            console.error(e)
        })
    }
    get inputDataViews () {
        return this._inputDataViews
    }
    get outputDataViews () {
        return this._outputDataViews
    }
    async writeData (data: TypedNumberArray[]) {
        if (data.length !== this._outputDataBuffers.length) {
            return false
        }
        await this.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE, () => {
            for (let i=0; i<data.length; i++) {
                this.outputDataViews[i].set(data[i], DATA_POS)
            }
        })
        return true
    }
}

let MTX_OUT: TestMutex | null = null
let MTX_IN: TestMutex | null = null

describe('Initiation tests', () => {
    test('Class is defined', () => {
        expect(IOMutex).toBeDefined()
    })
    test('Can construct with all array types', async () => {
        const int8Mutex = new TestMutex(
            Int8Array,
            [
                {
                    length: 1,
                    name: 'test',
                    position: 0
                }
            ],
            [
                {
                    length: 10,
                    name: 'data-array',
                    position: 0
                }
            ],
            [
                new Int8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
            ]
        )
        await int8Mutex.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            expect(int8Mutex.outputDataViews).toStrictEqual([new Int8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])
        })
        const int16Mutex = new TestMutex(
            Int16Array,
            [
                {
                    length: 1,
                    name: 'test',
                    position: 0
                }
            ],
            [
                {
                    length: 10,
                    name: 'data-array',
                    position: 0
                }
            ],
            [
                new Int16Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
            ]
        )
        await int16Mutex.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            expect(int16Mutex.outputDataViews).toStrictEqual([new Int16Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])
        })
        const int32Mutex = new TestMutex(
            Int32Array,
            [
                {
                    length: 1,
                    name: 'test',
                    position: 0
                }
            ],
            [
                {
                    length: 10,
                    name: 'data-array',
                    position: 0
                }
            ],
            [
                new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
            ]
        )
        await int32Mutex.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            expect(int32Mutex.outputDataViews).toStrictEqual([new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])
        })
        const float32Mutex = new TestMutex(
            Float32Array,
            [
                {
                    length: 1,
                    name: 'test',
                    position: 0
                }
            ],
            [
                {
                    length: 10,
                    name: 'data-array',
                    position: 0
                }
            ],
            [
                new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
            ]
        )
        await float32Mutex.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            expect(float32Mutex.outputDataViews).toStrictEqual([new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])])
        })
    })
    const MTX_OUT = new TestMutex(
        Int32Array,
        [
            {
                length: 1,
                name: 'current-array',
                position: 0
            }
        ],
        [
            {
                length: 1,
                name: 'total-fields',
                position: 0,
                data: [10]
            },
            {
                length: 1,
                name: 'fields-loaded',
                position: 1,
                data: [0]
            },
            {
                length: 10,
                name: 'data',
                position: 2,
            }
        ],
        [
            new Int32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
            new Int32Array([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
            new Int32Array([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
        ]
    )
    const MTX_IN = new TestMutex(
        Int32Array,
        [
            {
                length: 1,
                name: 'current-array',
                position: 0,
                data: [0]
            }
        ],
        [
            {
                length: 1,
                name: 'total-computations',
                position: 0,
                data: [10]
            },
            {
                length: 1,
                name: 'computations-done',
                position: 1,
                data: [0]
            },
            {
                length: 10,
                name: 'results',
                position: 2
            }
        ],
        [
            new Float32Array(10)
        ],
        MTX_OUT.exportForInputCouple()
    )
    test('Can lock and unlock array', async () => {
        const lock = await MTX_OUT.lock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(lock).toStrictEqual(true)
        const unlock = MTX_OUT.unlock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(unlock).toStrictEqual(true)
    })
    test('Can read output buffers', async () => {
        MTX_OUT.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            expect(MTX_OUT.outputDataViews).toStrictEqual([
                new Int32Array([10, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
                new Int32Array([10, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
                new Int32Array([10, 0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
            ])
        }).catch((e) => {
            console.error(e)
        })
    })
    test('Can write to output buffers', async () => {
        const write = await MTX_OUT.writeData([
            new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
            new Int32Array([0, 2, 4, 6, 8, 10, 18, 14, 16, 18]),
            new Int32Array([0, 2, 4, 8, 16, 32, 64, 128, 256, 512]),
        ])
        expect(write).toStrictEqual(true)
    })
    test('Can read input buffers', async () => {
        MTX_IN.executeWithLock(IOMutex.MUTEX_SCOPE.INPUT, IOMutex.OPERATION_MODE.READ, () => {
            expect(MTX_IN.inputDataViews).toStrictEqual([
                new Int32Array([10, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
                new Int32Array([10, 0, 0, 2, 4, 6, 8, 10, 18, 14, 16, 18]),
                new Int32Array([10, 0, 0, 2, 4, 8, 16, 32, 64, 128, 256, 512]),
            ])
        }).catch((e) => {
            console.error(e)
        })
    })
    test('Cannot read input buffers locked by the output mutex', async () => {
        const writeLock = await MTX_OUT.lock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(writeLock).toStrictEqual(true)
        try {
            const readLock = await MTX_IN.lock(IOMutex.MUTEX_SCOPE.INPUT, IOMutex.OPERATION_MODE.READ, 1)
            expect(readLock).toStrictEqual(false)
        } catch (e) {
            console.error(e)
        }
        const writeUnlock = MTX_OUT.unlock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE)
        expect(writeUnlock).toStrictEqual(true)
    })
})
