# Asymmetric I/O Mutex
A JavaScript shared array buffer mutex with asymmetric input and output buffers.

Version 0.6 greatly extends the class and is a breaking change.

## Installation

`npm install --save asymmetric-io-mutex`

## Features

* Accepts an array buffer as input and output.
* Data arrays within the mutex share the same configuration (except for length).
* Configurations can differ between the input and output sides (hence asymmetrical).
* Submitting a lock buffer to the new mutex along with the input data buffers will allow atomic memory read and write operations between the mutex that has the buffers as its output and the mutex that uses them as input.
* Due to atomic wait operations requiring a Int32Array as input, the mutex only works with 32-bit typed arrays.

## Important

* Always lock the buffers before reading or modifying them (technically you don't have to, but that would kind of defeat the whole point). The `executeWithLock()` method takes care of the locking and unlocking for you.
* An output mutex's buffers and meta fields should be passed to the new input mutex with the `propertiesForCoupling` property.
* Int32Array is the expected metadata buffer type and the default empty field value is set accordingly. You can change it by setting the IOMutex.EMPTY_FIELD **before** initiating the mutex.

Simple usage:
```javascript
class MyCustomMutex extends IOMutex {
    constructor (metaFields: MutexMetaField[], dataFields: MutexMetaField[], dataArrays = [] as <any typed number array>[], dataConstructor: <any typed array constructor>, coupledMutexProps?: MutexExportProperties) {
        super(
            metaFields,
            dataFields,
            coupledMutexProps
        )
        // Find out required buffer length
        let bufferLen = IOMutex.LOCK_LENGTH // 32-bit numbers needed for the lock
        bufferLen += metaFields.reduce((totalLen, f) => totalLen + f.length, 0)
        const dataFLen += dataFields.reduce((totalLen, f) => totalLen + f.length, 0)
        bufferLen += dataArrays.reduce((totalLen, a) => totalLen + a.length + dataFLen, 0)
        this.initialize(new SharedArrayBuffer(bufferLen*4)) // 4 bytes per 32-bit element
        this.setDataArrays(dataArrays.map(a => { return { constructor: dataConstructor, length: a.length } }))
        for (let i=0; i<dataArrays.length; i++) {
            for (let j=0; j<dataFields.length; j++) {
                const field = dataFields[j]
                if (field.data) {
                    this._setOutputDataFieldValue(i, field.name, field.data[0])
                }
            }
            this.setData(i, dataArrays[i])
        }
    }
    // Any additional methods you want to expose.
}
```

See the /tests for a more complex example implementation.
