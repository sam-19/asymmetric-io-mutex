/**
 * Asymmetric I/O Mutex read-only typed arrays.
 * @package    asymmetric-io-mutex
 * @copyright  2022 Sampsa Lohi
 * @license    MIT
 */

// Read-only typed array extensions by Daniel Imms:
// https://www.growingwiththeweb.com/2020/10/typescript-readonly-typed-arrays.html
// As types these don't really prevent modification of the arrays, merely warn against it.

/**
 * All the properties (methods) of typed arrays that can change the contents of the array.
 */
export type TypedArrayMutableProperties = 'copyWithin' | 'fill' | 'reverse' | 'set' | 'sort'
/**
 * Read-only Uint8ClampedArray.
 */
export interface ReadonlyUint8ClampedArray extends Omit<Uint8ClampedArray, TypedArrayMutableProperties> {
    readonly [i: number]: number
}
/**
 * Read-only Uint8Array.
 */
export interface ReadonlyUint8Array extends Omit<Uint8Array, TypedArrayMutableProperties> {
    readonly [i: number]: number
}
/**
 * Read-only Uint16Array.
 */
export interface ReadonlyUint16Array extends Omit<Uint16Array, TypedArrayMutableProperties> {
    readonly [i: number]: number
}
/**
 * Read-only Uint32Array.
 */
export interface ReadonlyUint32Array extends Omit<Uint32Array, TypedArrayMutableProperties> {
    readonly [i: number]: number
}
/**
 * Read-only Int8Array.
 */
export interface ReadonlyInt8Array extends Omit<Int8Array, TypedArrayMutableProperties> {
    readonly [i: number]: number
}
/**
 * Read-only Int16Array.
 */
export interface ReadonlyInt16Array extends Omit<Int16Array, TypedArrayMutableProperties> {
    readonly [i: number]: number
}
/**
 * Read-only Int32Array.
 */
export interface ReadonlyInt32Array extends Omit<Int32Array, TypedArrayMutableProperties> {
    readonly [i: number]: number
}
/**
 * Read-only Float32Array.
 */
export interface ReadonlyFloat32Array extends Omit<Float32Array, TypedArrayMutableProperties> {
    readonly [i: number]: number
}
/**
 * Read-only Float64Array.
 */
export interface ReadonlyFloat64Array extends Omit<Float64Array, TypedArrayMutableProperties> {
    readonly [i: number]: number
}
/**
 * Read-only BigInt64Array.
 */
export interface ReadonlyBigInt64Array extends Omit<BigInt64Array, TypedArrayMutableProperties> {
    readonly [i: number]: bigint
}
/**
 * Read-only BigUint64Array.
 */
export interface ReadonlyBigUint64Array extends Omit<BigUint64Array, TypedArrayMutableProperties> {
    readonly [i: number]: bigint
}
