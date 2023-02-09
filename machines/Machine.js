const MachineTypes = {
    LASER: "LASER",
    CNC: "CNC"
};

const MachineConnectionTypes = {
    SERIAL: "SERIAL",
    NONE: "NONE"
};


class MachineStatus {
    x = 0;
    y = 0;
    z = 0;
    offset = {x:0, y:0, z:0};
    probeContact = false;
    probeOffset = {z:0};
}

class Machine {
    name = "";
    image = "";
    type = MachineTypes.CNC;
    connection = null;
    connectionType = MachineConnectionTypes.NONE;
    status = new MachineStatus();
    abortOnProbe = true;
    operationList = []
    operation = null;

    constructor(){}
    init(){}
    connect() {
        if(this.connection) return this.connection.connect()
        return false;
    }
    disconnect() {
        if(this.connection) return this.connection.disconnect()
        return false;
    }
    isConnected() { 
        if(this.connection) return this.connection.connected 
        return false;
    }
    abortMove()     { throw new Error('Not implemented'); }
    updateStatus()  { throw new Error('Not implemented'); }
    moveSpindleStep(axis, stepCount, secondAxis=null, secondStepCount=null) { throw new Error('Not implemented'); }
    moveSpindleAbsolute(positions, feedRate=100, stopOnProbe=true, controlledMove=true) { throw new Error('Not implemented'); }
    startSpindle(speed)   { throw new Error('Not implemented'); }
    stopSpindle()   { throw new Error('Not implemented'); }
    setHome(axes)   { throw new Error('Not implemented'); }
    probe(axis, moveAway, feedRate)   { throw new Error('Not implemented'); }
    reportError(err) {
        alert(err);
    }



}