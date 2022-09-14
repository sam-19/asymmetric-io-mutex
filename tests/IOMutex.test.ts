/**
 * Asymmetric IO Mutex tests.
 * @package    asymmetric-io-mutex
 * @copyright  2022 Sampsa Lohi
 * @license    MIT
 */

import {describe, expect, test} from '@jest/globals'
import IOMutex from '../src'

describe('Initiation tests', () => {
    test('Class is defined', () => {
        expect(IOMutex).toBeDefined()
    })
})
