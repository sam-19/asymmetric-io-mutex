/**
 * Asymmetric I/O Mutex buffer reposition tests.
 *
 * Cover the memory-manager rearrange support: `setBufferStartPosition` rebinding a mutex's own
 * views after its region has moved, `shiftInputPositions` rebinding a coupled mutex's input
 * views after the source region has moved, and the `initialize` buffer-size guard. The byte
 * moves themselves are performed manually here, mirroring what the memory-manager worker's
 * release-and-rearrange does to the shared buffer.
 *
 * @package    asymmetric-io-mutex
 * @copyright  2026 Sampsa Lohi
 * @license    MIT
 */

import IOMutex from '../src'
import { BufferRangeMove, MutexMetaField } from '../src/AsymmetricMutex'

let expectError = false
// Catch console errors
beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation((message: any) => {
        if (!expectError) {
            console.log('Unexpected error:', message)
        }
    })
})
afterEach(() => {
    (console.error as any).mockClear()
    expectError = false
})
afterAll(() => {
    (console.error as any).mockRestore()
})

const META_FIELDS: MutexMetaField[] = [
    {
        constructor: Int32Array,
        length: 1,
        name: 'meta-a',
        position: 0,
    },
]
const DATA_FIELDS: MutexMetaField[] = [
    {
        constructor: Int32Array,
        length: 1,
        name: 'field-a',
        position: 0,
    },
]
/** Data array length in elements. */
const DATA_LEN = 4
/**
 * Total 32-bit length of a mutex built by `buildMutex`:
 * lock (1) + meta (1) + 2 × (data field (1) + data (4)).
 */
const MUTEX_LEN = 1 + 1 + 2*(1 + DATA_LEN)

/** Construct a mutex with one meta field and two data arrays at `start` in `buffer`. */
const buildMutex = async (buffer: SharedArrayBuffer, start: number) => {
    const mutex = new IOMutex(META_FIELDS.map(f => ({ ...f })))
    expect(mutex.initialize(buffer, start)).toBe(true)
    expect(mutex.setDataFields(DATA_FIELDS.map(f => ({ ...f })))).toBe(true)
    expect(mutex.setDataArrays([
        { constructor: Int32Array, length: DATA_LEN },
        { constructor: Int32Array, length: DATA_LEN },
    ])).toBe(true)
    await mutex.setMetaFieldValue('meta-a', 42)
    await mutex.setDataFieldValue('field-a', 7, [0])
    await mutex.setDataFieldValue('field-a', 8, [1])
    await mutex.setData(0, new Int32Array([1, 2, 3, 4]))
    await mutex.setData(1, new Int32Array([5, 6, 7, 8]))
    return mutex
}

/** Move `length` 32-bit elements from `from` to `to` within the buffer. */
const moveRegion = (buffer: SharedArrayBuffer, from: number, to: number, length: number) => {
    const view = new Int32Array(buffer)
    view.copyWithin(to, from, from + length)
}

describe('Own-view reposition (setBufferStartPosition)', () => {
    test('Views rebind to the moved region and read the same values', async () => {
        const sab = new SharedArrayBuffer(64*4)
        const oldStart = 20
        const newStart = 4
        const mutex = await buildMutex(sab, oldStart)
        moveRegion(sab, oldStart, newStart, MUTEX_LEN)
        expect(mutex.setBufferStartPosition(newStart)).toBe(true)
        expect(mutex.BUFFER_START).toBe(newStart)
        expect(await mutex.getMetaFieldValue('meta-a')).toBe(42)
        const fieldVals = await mutex.getDataFieldValue('field-a')
        expect(fieldVals).toStrictEqual([7, 8])
        // Each data array view covers the whole array entry: data field header + samples.
        const views = mutex.outputDataViews
        expect(Array.from((views[0] as Int32Array).subarray(1))).toStrictEqual([1, 2, 3, 4])
        expect(Array.from((views[1] as Int32Array).subarray(1))).toStrictEqual([5, 6, 7, 8])
    })
    test('Write-lock view binds to the correct byte offset', async () => {
        // Regression: the lock-view rebuild used an element index as a byte offset, binding the
        // lock to a misaligned cell so every subsequent lock operation addressed wrong memory.
        const sab = new SharedArrayBuffer(64*4)
        const oldStart = 20
        const newStart = 4
        const mutex = await buildMutex(sab, oldStart)
        moveRegion(sab, oldStart, newStart, MUTEX_LEN)
        expect(mutex.setBufferStartPosition(newStart)).toBe(true)
        const lockView = (mutex as any)._writeLock.view as Int32Array
        expect(lockView.byteOffset).toBe((newStart + IOMutex.LOCK_POS)*4)
        // Locking still works against the relocated cell.
        const locked = await mutex.executeWithLock(IOMutex.MUTEX_SCOPE.OUTPUT, IOMutex.OPERATION_MODE.READ, () => {
            return true
        })
        expect(locked).toBe(true)
    })
    test('Reposition past the end of the buffer is refused', async () => {
        const sab = new SharedArrayBuffer(32*4)
        const mutex = await buildMutex(sab, 4)
        expectError = true
        expect(mutex.setBufferStartPosition(32 - 2)).toBe(false)
    })
})

describe('Input-view reposition (shiftInputPositions)', () => {
    test('Coupled views rebind when the source region moves', async () => {
        const sab = new SharedArrayBuffer(64*4)
        const oldStart = 20
        const newStart = 2
        const source = await buildMutex(sab, oldStart)
        const coupled = new IOMutex(undefined, undefined, source.propertiesForCoupling)
        // The coupled read lock is the source's write lock.
        expect(((coupled as any)._readLockView as Int32Array).byteOffset).toBe((oldStart + IOMutex.LOCK_POS)*4)
        moveRegion(sab, oldStart, newStart, MUTEX_LEN)
        expect(source.setBufferStartPosition(newStart)).toBe(true)
        const moves: BufferRangeMove[] = [
            { start: oldStart, end: oldStart + MUTEX_LEN, delta: newStart - oldStart },
        ]
        expect(coupled.shiftInputPositions(moves)).toBe(true)
        expect(((coupled as any)._readLockView as Int32Array).byteOffset).toBe((newStart + IOMutex.LOCK_POS)*4)
        expect(((coupled as any)._inputMetaView as Int32Array).byteOffset).toBe((newStart + IOMutex.META_START_POS)*4)
        // A write through the moved source is visible through the shifted input views.
        await source.setData(0, new Int32Array([11, 12, 13, 14]))
        const inputView = (coupled as any)._inputDataViews[0] as Int32Array
        // The input data view covers the whole array entry: data field header + samples.
        expect(Array.from(inputView.subarray(1))).toStrictEqual([11, 12, 13, 14])
    })
    test('Views outside every moved region stay untouched', async () => {
        const sab = new SharedArrayBuffer(64*4)
        const start = 8
        const source = await buildMutex(sab, start)
        const coupled = new IOMutex(undefined, undefined, source.propertiesForCoupling)
        const before = ((coupled as any)._readLockView as Int32Array).byteOffset
        const moves: BufferRangeMove[] = [
            { start: 40, end: 50, delta: -10 },
        ]
        expect(coupled.shiftInputPositions(moves)).toBe(true)
        expect(((coupled as any)._readLockView as Int32Array).byteOffset).toBe(before)
    })
})

describe('Initialize size guard', () => {
    test('A buffer with enough elements-worth of bytes but too few actual bytes is refused', () => {
        // Regression: the guard compared a 32-bit element count against a byte count, letting a
        // buffer a quarter of the needed size pass and the views overflow it.
        const mutex = new IOMutex([
            { constructor: Int32Array, length: 4, name: 'meta-wide', position: 0 },
        ])
        const tooSmall = new SharedArrayBuffer(8)
        expectError = true
        expect(mutex.initialize(tooSmall, 0)).toBe(false)
    })
})
