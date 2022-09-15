# Asymmetric IO Mutex
A JavaScript shared array buffer mutex with asymmetric input and output buffers.

## Installation

`npm install --save asymmetric-io-mutex`

## Features

* Accepts an array of buffers as input and output.
* Buffers within the array share the same configuration.
* Configurations and array sizes can differ between the input and output sides (hence asymmetrical).
* Submitting a lock buffer to the new mutex along with the input data buffers will allow atomic memory read and write operations between the mutex that has the buffers as its output and the mutex that uses them as input.

## Important

* The IOMutex class is meant to be extended by a custom class; most of its properties are protected and of no use unless extended.
* Always lock the buffers before reading or modifying them (technically you don't have to, but that would kind of defeat the whole point). The `executeWithLock()` method takes care of the locking and unlocking for you.
* An output mutex's buffers and meta fields should be passed to the new input mutex with the `propertiesForCoupling()` method.

Simple usage:
```javascript
class MyCustomMutex extends IOMutex {
    constructor (viewConstructor: <any typed array constructor>, metaFields: MutexMetaField[], dataFields: MutexMetaField[], dataArrays = [] as <any typed number array>[], coupledMutexProps?: MutexExportProperties) {
        super(
            metaFields,
            viewConstructor,
            viewConstructor,
            coupledMutexProps ?
            {
                metaViewConstructor: viewConstructor,
                dataViewConstructor: viewConstructor,
                coupledMutexProps: coupledMutexProps
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
            if (coupledMutexFields) {
                for (const buf of (coupledMutexFields.dataBuffers || [])) {
                    this._inputDataViews.push(new coupledMutexFields.dataViewConstructor(buf))
                }
            }
        }).catch(e => {
            console.error(e)
        })
    }
    // Any additional methods you want to expose
}
```

See the test file for a more complex example implementation.
