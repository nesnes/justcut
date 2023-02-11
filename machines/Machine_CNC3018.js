/*
    G0 [X42] [Y42] [Z42]        // Rapid movement
    G1 [X42] [Y42] [Z42] [F42]  // Controlled movement F = feedrate 
    G4 timeInMs                 // Delay
    G21                         // Units to mm  
    G38.2 X42 F42               // Move on X axis up to 42 until probe is detected
    G90                         // Absolute coordinates
    G91                         // Relative coordinates
    G92 [X42] [Y42] [Z42]       // Store current position as value
*/

class Machine_CNC3018 extends Machine {
    constructor() {
        super();
        this.name = "CNC3018";
        this.image = "images/CNC3018/machine.svg"
        this.type = MachineTypes.CNC;
        this.connectionType = MachineConnectionTypes.SERIAL;
        this.pendingCommands = [];
        this.operationList = [
            {
                name: "PCB Milling",
                image: "images/CNC3018/operation-pcb.svg",
                index: 0,
                steps: [
                    { validated: false, id:"select-file", name:"Select image file", image:"images/CNC3018/machine.svg" },
                    { validated: false, id:"compute-path", name:"Compute tool paths", image:"images/CNC3018/machine.svg" },
                    { validated: false, id:"install-martyr", name:"Intall martyr", image:"images/CNC3018/pcb/martyr.svg" },
                    { validated: false, id:"install-pcb", name:"Install PCB", image:"images/CNC3018/pcb/tape.svg" },
                    { validated: false, id:"install-tool", name:"Install tool", image:"images/CNC3018/pcb/tool.svg" },
                    { validated: false, id:"install-probe", name:"Install probe wires", image:"images/CNC3018/pcb/wires.svg" },
                    { validated: false, id:"power-on", name:"Power ON the machine", image:"images/CNC3018/pcb/power-on.svg" },
                    { validated: false, id:"home-x-y", name:"Move to X/Y home position", image:"images/CNC3018/pcb/home.svg" },
                    { validated: false, id:"probe-z", name:"Probe PCB height", image:"images/CNC3018/pcb/probe-z.svg" },
                    { validated: false, id:"probe-surface", name:"Probe surface", image:"images/CNC3018/pcb/grid-probe.svg" },
                    { validated: false, id:"remove-probe", name:"Remove probe wires", image:"images/CNC3018/pcb/remove-wire.svg" },
                    { validated: false, id:"run-job", name:"Run the job", image:"" }
                ]
            }
        ]
    }

    init() {
        this.connection = new SerialPort()
        this.connection.baudrate = 115200;
        this.connection.readHandler = (msg)=>{this.onRead(msg);} ;
    }

    sendCommand(data) {
        console.log(data)
        return new Promise((resolve, reject)=>{
            this.pendingCommands.unshift({resolve,reject});
            this.connection.write(data);
        });
    }

    onRead(msg) {
        console.log(msg)
        if(msg.startsWith('<')) this.parseStatus(msg);
        if(msg.startsWith("[PRB:")) this.parseProbe(msg);
        if(msg.startsWith("ok") || msg.startsWith("err")) {
            setTimeout(()=>{
                if(this.pendingCommands.length) {
                let task = this.pendingCommands[0];
                this.pendingCommands.splice(0,1);
                if(msg.startsWith("ok")) task.resolve();
                else task.reject();
                }
            },0);
        }
    }

    parseStatus(data){
        // Reset probe
        this.status.probeContact = false;

        // Parse status
        data = data.replace("<", "");
        data = data.replace(">", "");
        let statusElements = data.split("|");
        //if(statusTab[0]) this.status.mode = statusTab[0];
        for(let elem of statusElements){
          // Spindle position
            if(elem.startsWith("MPos:")) {
                elem = elem.replace("MPos:","");
                let positionArray = elem.split(",");
                if(positionArray.length == 3){
                    this.status.x = parseFloat(positionArray[0]);
                    this.status.y = parseFloat(positionArray[1]);
                    this.status.z = parseFloat(positionArray[2]);
                }
            }
            // Probe
            else if(elem.startsWith("Pn:P")) {
                this.status.probeContact = true;
                if(this.abortOnProbe) this.abortMove();
            }
        }
    }

    parseProbe(data){
        data = data.replace("[PRB:","");
        let positionArray = data.split(",");
        if(positionArray.length == 3){
            //this.status.probeOffset.x = parseFloat(positionArray[0]);
            //this.status.probeOffset.y = parseFloat(positionArray[1]);
            this.status.probeOffset.z = parseFloat(positionArray[2].split(":")[0]);
        }
    }

    abortMove() {
        return this.sendCommand(String.fromCharCode(0x85))
    }

    updateStatus() {
        return this.sendCommand("?");
    }

    moveSpindleStep(axes, feedRate){
        this.abortOnProbe = true;
        if('z' in axes && axes.z>0) this.abortOnProbe = false; // So we can go up if touching the PCB
        let cmd = "$J=G21G91";
        if('x' in axes) cmd += `X${axes.x.toFixed(3)}`
        if('y' in axes) cmd += `Y${axes.y.toFixed(3)}`
        if('z' in axes) cmd += `Z${axes.z.toFixed(3)}`
        cmd += "F"+feedRate.toFixed(3);
        return this.sendCommand(cmd);
    }
    
    moveSpindleAbsolute(positions, feedRate=100, stopOnProbe=true, controlledMove=true){
        this.abortOnProbe = stopOnProbe;
        let cmd = `G21 G90`;
        if(controlledMove) cmd += ' G1';
        else  cmd += ' G0';
        if('x' in positions) cmd += ` X${positions.x.toFixed(3)}`
        if('y' in positions) cmd += ` Y${positions.y.toFixed(3)}`
        if('z' in positions) cmd += ` Z${positions.z.toFixed(3)}`
        if(controlledMove) cmd += ` F${feedRate.toFixed(0)}`;
        return this.sendCommand(cmd);
    }

    startSpindle(speed=10000){
        return this.sendCommand(`M3 S${speed}`).catch((e)=>{
            this.reportError("Machine refused to start spindle. Causes: machine in error, moving...");
            this.stopSpindle();
        });
    }

    stopSpindle(){
        return this.sendCommand('M5');
    }

    setHome(axes={x:1, y:1}){
        let cmd = 'G92';
        if('x' in axes && axes.x) cmd += " X0";
        if('y' in axes && axes.y) cmd += " Y0";
        if('z' in axes && axes.z) cmd += " Z0";
        this.sendCommand(cmd).then(()=>{
            this.updateStatus().then(()=>{
                if('x' in axes && axes.x) this.status.offset.x = this.status.x;
                if('y' in axes && axes.y) this.status.offset.y = this.status.y;
                if('z' in axes && axes.z) this.status.offset.z = this.status.z;
            })
        })
    }
    
    probe(axis, moveAway=true, feedRate=20) {
        let maxDist = -20;
        let cmd = `G21 G38.2 ${axis}${maxDist} F${feedRate}`
        if(!moveAway){ //Only probe
            return this.sendCommand(cmd);
        }
        else { // probe and move away
            return new Promise((resolve, reject)=>{
                this.sendCommand(cmd).then(()=>{
                    this.sendCommand(`G92 ${axis}0`).then(()=>{
                        this.updateStatus().then(()=>{
                            this.status.offset.z = this.status.z;
                            this.moveSpindleAbsolute({z:5}, 1000, false).then(()=>{
                                resolve();
                            }).catch(()=>{reject();})
                        }).catch(()=>{reject();})
                    }).catch(()=>{reject();})
                }).catch(()=>{reject();})
            });
        }
    }
}