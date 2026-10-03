/**
 * Asymmetric I/O Mutex regression tests.
 *
 * Each case pins a defect that was dormant because no other test exercised the path: a write whose
 * result was never awaited, a view built without the mutex's own start offset, a lock that could
 * never resolve, a scope-dependent list that could be undefined, and a bounds check comparing
 * against the wrong index.
 * @package    asymmetric-io-mutex
 * @copyright  2025 Sampsa Lohi
 * @license    MIT
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import IOMutex from '../src'
import type { MutexMetaField, MutexScope, TypedNumberArray } from '../src/AsymmetricMutex'

const metaField = (name: string, length = 1): MutexMetaField => ({
    constructor: Int32Array,
    length: length,
    name: name,
    position: IOMutex.UNASSIGNED_VALUE,
})

/** Exposes the protected members the cases below need to reach. */
class TestMutex extends IOMutex {
    getDataFieldValueAt (scope: MutexScope, index: number, field: string) {
        return this._getDataFieldValue(scope, index, field)
    }
    setOutputDataFieldValueAt (index: number, field: string, ...values: number[]) {
        return this._setOutputDataFieldValue(index, field, ...values)
    }
}

/**
 * A mutex with `arrays` data arrays of `length` elements each, bound at `start`.
 *
 * `setDataFields` is called even for an empty field list, because it is what creates the output
 * data properties that `setDataArrays` then fills.
 */
const buildMutex = (
    arrays: number,
    length: number,
    start = 0,
    dataFields: MutexMetaField[] = []
) => {
    const mutex = new TestMutex([metaField('meta')])
    // Room for the start offset, the lock, the meta field and every array with its own fields.
    const fieldsLen = dataFields.reduce((total, f) => total + f.length, 0)
    const buffer = new SharedArrayBuffer((start + 2 + arrays*(length + fieldsLen) + 8)*4)
    mutex.initialize(buffer, start)
    mutex.setDataFields(dataFields)
    mutex.setDataArrays(Array(arrays).fill({ constructor: Int32Array, length: length }))
    return mutex
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('setDataFieldValue reports the result of the writes it performs', () => {
    test('A refused write is reported as a failure', async () => {
        // The field holds two elements, so the single value `setDataFieldValue` passes on is the
        // wrong size and every per-array write refuses it. Awaiting those writes is what makes the
        // refusal visible: an unawaited call collects promises, which are always truthy.
        const mutex = buildMutex(2, 4, 0, [metaField('pair', 2)])
        await expect(mutex.setDataFieldValue('pair', 1)).resolves.toBe(false)
    })
    test('An accepted write is reported as a success', async () => {
        const mutex = buildMutex(2, 4, 0, [metaField('single')])
        await expect(mutex.setDataFieldValue('single', 7)).resolves.toBe(true)
    })
    test('The value has been written by the time the call resolves', async () => {
        const mutex = buildMutex(1, 4, 0, [metaField('single')])
        await mutex.setDataFieldValue('single', 42)
        const values = await mutex.getDataFieldValue('single')
        expect(values).toEqual([42])
    })
})

describe('Meta fields are given positions of their own', () => {
    test('A field declared with the unassigned sentinel does not land on the lock', () => {
        // `UNASSIGNED_VALUE` is how a data field asks to be positioned, so a meta field is written
        // the same way. Left unassigned, its position resolves one slot in front of the meta
        // region, and initializing it to the empty-field value replaces the lock value there.
        const mutex = new IOMutex([metaField('unpositioned')])
        const buffer = new SharedArrayBuffer(64*4)
        mutex.initialize(buffer)
        expect(new Int32Array(buffer, 0, 1)[0]).toBe(IOMutex.UNLOCKED_VALUE)
        expect(mutex.outputMetaFields[0].position).toBe(0)
    })
    test('Positions are sequential across fields and an explicit one is kept', () => {
        const explicit = { constructor: Int32Array, length: 1, name: 'explicit', position: 5 }
        const mutex = new IOMutex([metaField('first'), explicit, metaField('third')])
        expect(mutex.outputMetaFields.map(f => f.position)).toEqual([0, 5, 2])
    })
    test('The mutex still locks after a field was declared unpositioned', async () => {
        const mutex = new IOMutex([metaField('unpositioned')])
        mutex.initialize(new SharedArrayBuffer(64*4))
        await expect(mutex.setMetaFieldValue('unpositioned', 3)).resolves.toBe(true)
        expect(await mutex.getMetaFieldValue('unpositioned')).toBe(3)
    })
})

describe('Views are built from the start of the buffer', () => {
    test('setMetaFields on a bound mutex honours the buffer start position', () => {
        // Called after `initialize`, so the view is built immediately. A mutex that does not sit at
        // the start of the buffer would otherwise point at the region in front of it.
        const start = 32
        const mutex = buildMutex(1, 4, start)
        mutex.setMetaFields([metaField('replaced')])
        expect(mutex.outputMetaView?.byteOffset).toBe((start + IOMutex.META_START_POS)*4)
    })
    test('A second mutex sharing the buffer keeps its own metadata', async () => {
        const buffer = new SharedArrayBuffer(256*4)
        const first = new TestMutex([metaField('value')])
        first.initialize(buffer, 0)
        const second = new TestMutex([metaField('value')])
        second.initialize(buffer, 64)
        // Rebuilding the second mutex's meta fields must not move its view on top of the first's.
        second.setMetaFields([metaField('value')])
        await first.setMetaFieldValue('value', 11)
        await second.setMetaFieldValue('value', 22)
        expect(await first.getMetaFieldValue('value')).toBe(11)
        expect(await second.getMetaFieldValue('value')).toBe(22)
    })
})

describe('An uninitialized mutex answers rather than hanging', () => {
    test('lock resolves false instead of leaving the promise pending', async () => {
        const mutex = new IOMutex([metaField('meta')])
        const pending = Symbol('pending')
        const settled = await Promise.race([
            mutex.lock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.WRITE),
            new Promise(resolve => setTimeout(() => resolve(pending), 250)),
        ])
        expect(settled).toBe(false)
    })
})

describe('The output scope tolerates absent data arrays', () => {
    test('A field read before the arrays exist returns null', async () => {
        // `_outputData` is null until data fields are set, so mapping its arrays yields undefined.
        const mutex = new TestMutex([metaField('meta')])
        mutex.initialize(new SharedArrayBuffer(64*4))
        await expect(
            mutex.getDataFieldValueAt(IOMutex.MUTEX_SCOPE.OUTPUT, 0, 'absent')
        ).resolves.toBeNull()
    })
})

describe('A field is written at the address it is waited on', () => {
    /**
     * The index each side of the handshake names for the same field. `Atomics` is spied on rather
     * than driven, because `Atomics.wait` blocks the calling thread: a test that let it run could
     * not then perform the write it is waiting for.
     */
    const handshake = async (
        mutex: TestMutex,
        write: () => Promise<unknown>,
        wait: () => unknown
    ) => {
        // The lock views are one element long, so a notify against the whole buffer is a field.
        const notify = vi.spyOn(Atomics, 'notify')
        await write()
        const notified = notify.mock.calls
            .filter(call => (call[0] as unknown as Int32Array).length > 1)
            .map(call => call[1])
        notify.mockRestore()
        const waited: number[] = []
        const stub = (array: { length: number }, index: number) => {
            if (array.length > 1) {
                waited.push(index)
            }
            return 'ok'
        }
        // `Atomics.wait` is overloaded over two array types, so the stub is widened rather than
        // written against one of the two signatures.
        const waitSpy = vi.spyOn(Atomics, 'wait')
            .mockImplementation(stub as unknown as typeof Atomics.wait)
        await wait()
        waitSpy.mockRestore()
        return { notified, waited }
    }

    test('A meta field agrees between the setter and the waiter', async () => {
        const mutex = buildMutex(1, 4, 48)
        const { notified, waited } = await handshake(
            mutex,
            () => mutex.setMetaFieldValue('meta', 5),
            () => mutex.waitForFieldUpdate('meta', 0)
        )
        expect(notified).toHaveLength(1)
        expect(waited).toEqual(notified)
    })
    test('A data field agrees between the setter and the waiter', async () => {
        const mutex = buildMutex(2, 4, 48, [metaField('single')])
        const { notified, waited } = await handshake(
            mutex,
            () => mutex.setOutputDataFieldValueAt(1, 'single', 9),
            () => mutex.waitForFieldUpdate('data', 0, 1)
        )
        expect(notified).toHaveLength(1)
        expect(waited).toEqual(notified)
    })
    test('The address accounts for the mutex start, so two mutexes differ', async () => {
        const first = buildMutex(1, 4, 0)
        const second = buildMutex(1, 4, 48)
        const a = await handshake(
            first,
            () => first.setMetaFieldValue('meta', 1),
            () => first.waitForFieldUpdate('meta', 0)
        )
        const b = await handshake(
            second,
            () => second.setMetaFieldValue('meta', 2),
            () => second.waitForFieldUpdate('meta', 0)
        )
        expect(b.notified[0]).toBe((a.notified[0] as number) + 48)
    })
})

describe('setData bounds the number of arrays by where it starts writing', () => {
    test('More arrays than remain are truncated rather than running past the last one', async () => {
        const mutex = buildMutex(3, 4, 0)
        const data = [
            new Int32Array([1, 2, 3, 4]),
            new Int32Array([5, 6, 7, 8]),
        ] as TypedNumberArray[]
        // Two arrays starting at index 2 of three: only one fits. Comparing the count against the
        // offset within an array instead lets the loop index past the last array and throw.
        await expect(mutex.setData(2, data)).resolves.toBe(true)
        expect(Array.from(mutex.outputDataViews[2] as TypedNumberArray)).toEqual([1, 2, 3, 4])
    })
    test('Arrays that do fit are all written', async () => {
        const mutex = buildMutex(3, 4, 0)
        const data = [
            new Int32Array([1, 2, 3, 4]),
            new Int32Array([5, 6, 7, 8]),
        ] as TypedNumberArray[]
        await expect(mutex.setData(1, data)).resolves.toBe(true)
        expect(Array.from(mutex.outputDataViews[1] as TypedNumberArray)).toEqual([1, 2, 3, 4])
        expect(Array.from(mutex.outputDataViews[2] as TypedNumberArray)).toEqual([5, 6, 7, 8])
    })
})
