class SerialPort{
    constructor() {
        this.baudrate = 115200;
        this.portList = [];
        //this.listPorts();
        this.supported = "serial" in navigator;
        this.configured = false;
        this.webserial = null;
        this.webserialReader = null;
        this.connected = false;
        this.readHandler = null;
    }

    connect(){
        if(this.webserial){
            this.webserial.open({ baudRate: this.baudrate }).then(()=>{
                this.connected = true;
                this.readLoop().then(()=>{
                    this.connected = false;
                    this.webserial.close();
                    this.webserial = null;
                    this.configured = false;
                });
            }).catch((e)=>{console.log(e)});
        }
        else{
            this.listPorts(true)
        }
    }

    disconnect(){
        if(this.webserial && this.connected && this.webserialReader) {
            this.connected = false;
            this.webserialReader.cancel();
        }
    }

    async readLoop(){
        let buffer = "";
        while (this.connected && this.webserial.readable) {
            this.webserialReader = this.webserial.readable.getReader();
            try {
                while (this.connected) {
                  const { value, done } = await this.webserialReader.read();
                  if (done) { break; }
                  for(let char of value){
                    let c = String.fromCharCode(char);
                    if(c=='\n') {
                        if(this.readHandler){
                            this.readHandler(buffer);
                        }
                        buffer = "";
                    }
                    else { buffer += c; }
                  }
                }
            } catch (error) {
                console.log(error)
            } finally {
                this.webserialReader.releaseLock();
            }
        }
    }

    listPorts(connect=false){
        navigator.serial.requestPort().then((port)=>{
            if(connect) this.connect();
            this.webserial = port;
            this.configured = true;
        })
        .catch(()=>{});
    }

    write(text, escape="\n") {
        return new Promise((resolve, reject)=>{
            if(this.webserial && this.connected){
                const encoder = new TextEncoder();
                const writer = this.webserial.writable.getWriter();
                writer.write(encoder.encode(text+escape)).then(()=>{writer.releaseLock();resolve();});
                writer.releaseLock();
            }
            else reject();
        });
    }
}