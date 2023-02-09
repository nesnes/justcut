
var app = new Vue({
    el: '#app',
    data: {
        machineList: [
            new Machine_CNC3018()
        ],
        machine: null,
        sourceUrl: null,
        sourceImg: null,
        checklistIdx: -1,
        checklist: [
            { validated: false, id:"select-file", name:"Select image file" },
            { validated: false, id:"compute-path", name:"Compute tool paths" },
            { validated: false, id:"install-martyr", name:"Intall martyr" },
            { validated: false, id:"install-pcb", name:"Install PCB" },
            { validated: false, id:"install-tool", name:"Install tool" },
            { validated: false, id:"install-probe", name:"Install probe wires" },
            { validated: false, id:"power-on", name:"Power ON the machine" },
            { validated: false, id:"home-x-y", name:"Move to X/Y home position" },
            { validated: false, id:"probe-surface", name:"Probe surface" },
            { validated: false, id:"remove-probe", name:"Remove probe wires" },
            { validated: false, id:"run-job", name:"Run the job", onload:()=>{setTimeout(app.generateJobThumbnails, 50)} }
        ],
        tool: {
            previewWidth: 100,//px
            diameter: 3.175,//mm
            sideMargin: 2,//mm
            height: 22,//mm
            angleDegrees: 60,//degrees
            cravingDepth: 0.05,//mm
            contoursCount: 1
        },
        pcb: {
            copperThickness: 0.0348, //mm = 1oz,
            fiberThickness: 2,//mm
            surface: []
        },
        job: {
            contours: [],
            currentIndex: 0,
            bounds: {
                x: 0,
                y: 0,
                width: 0,
                height: 0
            },
            feedrate: 50,
            cravingDepth: 0.05,
            realWorldWidth: 0, //mm
            pixelsPerMillimeters: 0,
            stopRunningJob: null,
            stopRunningPath: null
        },
        probing: false,
        milling: false,

    },
    methods: {
        selectMachine: function(selected){
            this.machine = selected;
            this.machine.init();
        },
        selectOperation: function(selected){
            this.machine.operation = selected;
            this.machine.operation.index = 0;
        },
        currentOperationStep: function(){
            return this.machine.operation.steps[this.machine.operation.index]
        },
        nextOperationStep: function(){
            this.currentOperationStep().validated = true;
            this.machine.operation.index++;
            if(this.currentOperationStep().id == "run-job") setTimeout(app.generateJobThumbnails, 50);
            //if(this.currentOperationStep().onload) this.currentOperationStep().onload();
        },
        displayImage: function(img, div="previewCanvas"){
            let width = document.getElementById(div).offsetWidth;
            let height = document.getElementById(div).offsetHeight;
            let dst = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255,255,255, 255));
            // Prerserve ratio
            let scaleWidth = width / img.cols;
            let scaleHeight = height / img.rows;
            let scale = Math.min(scaleWidth, scaleHeight);
            let dstCenter = {x:width/2, y:height/2};
            let dstRoi = new cv.Rect(
                Math.floor(dstCenter.x - img.cols*scale/2),
                Math.floor(dstCenter.y - img.rows*scale/2),
                Math.floor(img.cols*scale),
                Math.floor(img.rows*scale)
            );
            let dstRoiImg = dst.roi(dstRoi);
            cv.resize(img, dstRoiImg, dstRoiImg.size(), 0, 0, cv.INTER_AREA);
            cv.imshow(div, dst);
            dst.delete(); 
        },
        openSourceFile: function(fileEvent){
            var file = fileEvent.target.files[0];
            if (!file) {
                return;
            }
            this.sourceUrl = URL.createObjectURL(file);
        },
        onSourceFileLoaded: function(){
            this.sourceImg = cv.imread(document.getElementById("sourceImage"));
            // Find bounding rect
            let grey = new cv.Mat();
            cv.cvtColor(this.sourceImg, grey, cv.COLOR_RGBA2GRAY, 0);
            cv.threshold(grey, grey, 120, 200, cv.THRESH_BINARY);
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(grey, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
            // Find biggest contour
            if(contours.size() == 0) return;
            let biggestContour = contours.get(0);
            let biggestArea = -1;
            let imgArea = (this.sourceImg.rows-1) * (this.sourceImg.cols-1);
            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt, false);
                if(area > biggestArea && area < imgArea) {
                    biggestContour = cnt;
                    biggestArea = area;
                }
            }
            this.job.bounds = cv.boundingRect(biggestContour);
            // Display width line
            let ones = new cv.Mat(this.sourceImg.rows, this.sourceImg.cols, cv.CV_8UC4, new cv.Scalar(127,127,127,0));
            let preview = new cv.Mat();
            cv.add(this.sourceImg, ones, preview)
            let topLeft = new cv.Point(this.job.bounds.x, 0);
            let bottomLeft = new cv.Point(this.job.bounds.x, this.sourceImg.rows);
            let topRight = new cv.Point(this.job.bounds.x + this.job.bounds.width, 0);
            let bottomRight = new cv.Point(this.job.bounds.x + this.job.bounds.width, this.sourceImg.rows);
            let lineColor = new cv.Scalar(255, 0, 0, 255);
            cv.line(preview, topLeft, bottomLeft, lineColor, 3, cv.LINE_AA);
            cv.line(preview, topRight, bottomRight, lineColor, 3, cv.LINE_AA);
            this.displayImage(preview);
            // Cleanup
            ones.delete(); preview.delete(); grey.delete(); contours.delete(); hierarchy.delete();
        },
        onScaleUpdate: function(){
            this.job.pixelsPerMillimeters = this.job.bounds.width / this.job.realWorldWidth;
        },
        getToolTipHeight: function(){
            let excludedAngle = 180 - this.tool.angleDegrees;
            return (this.tool.diameter/2)*Math.tan(excludedAngle/2*Math.PI/180);
        },
        getCravingWidth: function(){
            let width = Math.tan(this.tool.angleDegrees/180*Math.PI) * this.tool.cravingDepth;
            if (width<0) width = 0;
            return width;
        },
        computeToolpath: function(){
            let dst = new cv.Mat(this.sourceImg.rows, this.sourceImg.cols, cv.CV_8UC1, new cv.Scalar(255));
            let grey = new cv.Mat();
            let displayImg = this.sourceImg.clone();
            let imgArea = (this.sourceImg.rows-1) * (this.sourceImg.cols-1);
            cv.cvtColor(this.sourceImg, grey, cv.COLOR_RGBA2GRAY, 0);
            this.job.currentIndex = 0;
            this.job.contours.length = 0;
            for(let outlineIdx = 0; outlineIdx < this.tool.contoursCount; outlineIdx++){
                cv.threshold(grey, grey, 0, 255, cv.THRESH_BINARY);
                let contours = new cv.MatVector();
                let hierarchy = new cv.Mat();
                cv.findContours(grey, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

                // Create image with engraving ouline
                let lineColor = new cv.Scalar(0);
                let lineWidth = Math.round(this.getCravingWidth() * this.job.pixelsPerMillimeters);
                console.log(lineWidth, Math.round(lineWidth))
                for (let i = 0; i < contours.size(); ++i) {
                    let ci = contours.get(i);
                    if(cv.contourArea(ci, false) >= imgArea) continue;
                    for (let j = 0; j < ci.data32S.length; j += 2){
                        let p1 = new cv.Point(ci.data32S[ci.data32S.length-2], ci.data32S[ci.data32S.length-1]);
                        let p2 = new cv.Point(ci.data32S[j], ci.data32S[j+1]);
                        if(j>0) p1 = new cv.Point(ci.data32S[j-2], ci.data32S[j-1]);
                        cv.line(dst, p1, p2, lineColor, lineWidth, cv.LINE_AA);
                    }
                }
                cv.bitwise_and(dst, grey, grey);

                // Detect contours of oulined image
                cv.findContours(grey, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
                console.log(contours.size())
                for (let i = 0; i < contours.size(); ++i) {
                    let ci = contours.get(i)
                    let area = cv.contourArea(ci, false);
                    if(area >= imgArea) continue;
                    let path = {
                        points: [],
                        currentIndex: 0,
                        status: '',
                        area: area
                    };
                    for (let j = 0; j < ci.data32S.length; j += 2){
                        path.points.push({ x: ci.data32S[j],  y: ci.data32S[j+1] });
                    }
                    path.points.push({ x: ci.data32S[0],  y: ci.data32S[1] }); // Close path with first point
                    this.job.contours.push(path);
                }
                this.job.cravingDepth = this.tool.cravingDepth;
                // Sort job by area so biggest path are made first
                this.job.contours.sort((a,b)=>{ return a.area > b.area ? -1 : 1; })
                
                // Display oulined image
                let outlineColor = new cv.Scalar(255,0,0,255);
                let outlineWidth = Math.round(this.getCravingWidth() * this.job.pixelsPerMillimeters);
                for(let cnt of this.job.contours) {
                    for(let i = 1; i < cnt.points.length; i++) {
                        let p1 = new cv.Point(cnt.points[i-1].x, cnt.points[i-1].y);
                        let p2 = new cv.Point(cnt.points[i].x, cnt.points[i].y);
                        cv.line(displayImg, p1, p2, outlineColor, outlineWidth, cv.LINE_AA);
                    }
                }
                contours.delete(); hierarchy.delete();
            }

            console.log(this.job.contours)
            this.displayImage(displayImg);
            // Cleanup
            grey.delete(); dst.delete(); displayImg.delete();
        },
        generateJobThumbnails: function(index=0){
            let ones = new cv.Mat(this.sourceImg.rows, this.sourceImg.cols, cv.CV_8UC4, new cv.Scalar(127,127,127,0));
            let outlineColor = new cv.Scalar(255,0,0,255);
            let outlineWidth = Math.round(this.getCravingWidth() * this.job.pixelsPerMillimeters)*20;
            if(index>=this.job.contours.length) return;
            let path = this.job.contours[index];
            let displayImg = this.sourceImg.clone();
            cv.add(displayImg, ones, displayImg)
            for(let i = 1; i < path.points.length; i++) {
                let p1 = new cv.Point(path.points[i-1].x, path.points[i-1].y);
                let p2 = new cv.Point(path.points[i].x, path.points[i].y);
                cv.line(displayImg, p1, p2, outlineColor, outlineWidth, cv.LINE_AA);
            }
            this.displayImage(displayImg, 'path-preview-'+index)
            displayImg.delete();
            ones.delete();
            setTimeout(()=>{app.generateJobThumbnails(index+1);}, 10)
        },
        emergencyStop: function(){
            if(this.probing) this.probing = false;
            this.pauseJob();
            return this.machine.abortMove().then(this.machine.stopSpindle);
        },
        probeSurface: async function(width=-1, height=-1, stepx=0, stepy=0){
            if(this.probing) return;
            this.probing = true;
            if(width<0) width = this.job.bounds.width / this.job.pixelsPerMillimeters; //mm
            if(height<0) height = this.job.bounds.height / this.job.pixelsPerMillimeters; //mm
            if(stepx==0) stepx = 10;//width/5, 10); //mm
            if(stepy==0) stepy = 10;//Math.min(height/5, 10); //mm
            this.pcb.surface.length = 0;
            await this.machine.moveSpindleAbsolute({x:0, y:0}, 1000);
            await this.machine.probe('Z', true, 20);
            for(let x=0;x<=width;x+=stepx){
              for(let y=0;y<=height;y+=stepy){
                if(!this.probing) return;
                await this.machine.moveSpindleAbsolute({z:1}, 1000, false);
                if(!this.probing) return;
                await this.machine.moveSpindleAbsolute({x, y}, 1000);
                if(!this.probing) return;
                await this.machine.probe('Z', false, 20);
                this.pcb.surface.push({x, y, z: this.machine.status.probe_offset.z - this.machine.status.offset.z })
              } 
            }
            await this.machine.moveSpindleAbsolute({z:5}, 500, false);
            this.probing = false;
        },
        compute2DDist: function(a,b){
            let u = a.x - b.x;
            let v = a.y - b.y;
            return Math.sqrt(u*u + v*v);
        },
        getGridOffset: function(x,y){
            // Find 3 closetst points
            let orderdPoints = []
            for(let point of this.pcb.surface){
              let dist = this.compute2DDist(point, {x,y});
              orderdPoints.push({dist, point});
            }
            orderdPoints.sort((a, b) => (a.dist > b.dist) ? 1 : -1)
            if(orderdPoints.length<3) return 0;
            if(x==orderdPoints[0].point.x && y==orderdPoints[0].point.y) return orderdPoints[0].point.z;
            if(x==orderdPoints[1].point.x && y==orderdPoints[1].point.y) return orderdPoints[1].point.z;
            if(x==orderdPoints[2].point.x && y==orderdPoints[2].point.y) return orderdPoints[2].point.z;
            // Compute offset weigthed by points distance
            let ds = orderdPoints[0].dist + orderdPoints[1].dist + orderdPoints[2].dist;
            let no = 1/ds;
            let n1i = 1/(orderdPoints[0].dist*no);
            let n2i = 1/(orderdPoints[1].dist*no);
            let n3i = 1/(orderdPoints[2].dist*no);
            let nis = n1i+n2i+n3i;
            let f1 = n1i/nis;
            let f2 = n2i/nis;
            let f3 = n3i/nis;
            return f1*orderdPoints[0].point.z + f2*orderdPoints[1].point.z + f3*orderdPoints[2].point.z;
        },
        runPath: function(pathIndex=-1, startFromBegining=false, stopSpindleAtEnd=false){
            if(this.job.stopRunningPath) return;
            return new Promise(async (resolve, reject)=>{
                if(pathIndex < 0 || pathIndex >= this.job.contours.length) throw Error();
                let path = this.job.contours[pathIndex];
                let isRunning = true;
                this.job.stopRunningPath = ()=>{
                    isRunning = false;
                    path.status = "canceled";
                    this.job.stopRunningPath = null;
                    reject();
                };
                if(path.points.length < 1) throw Error();
                if(startFromBegining || path.status == "done" || path.currentIndex >= path.points.length) path.currentIndex = 0;
                let entryPoint = path.points[path.currentIndex];
                path.status = "running";
                if(isRunning) await this.machine.moveSpindleAbsolute({z:3}, 1000, false);
                if(isRunning) await this.machine.moveSpindleAbsolute({
                    x: entryPoint.x / this.job.pixelsPerMillimeters,
                    y: entryPoint.y / this.job.pixelsPerMillimeters
                }, 1000, false);
                if(isRunning) await this.machine.startSpindle();
                for(path.currentIndex; path.currentIndex < path.points.length; path.currentIndex++)
                {
                    let point = path.points[path.currentIndex];
                    let x = point.x / this.job.pixelsPerMillimeters;
                    let y = point.y / this.job.pixelsPerMillimeters;
                    let z = -this.job.cravingDepth + this.getGridOffset(x, y);
                    if(isRunning) await this.machine.moveSpindleAbsolute({x, y, z}, this.job.feedrate);
                    if(!isRunning) break; // should not use else to avoid currentIdex increment on fail
                }
                if(stopSpindleAtEnd) {
                    await this.machine.stopSpindle();
                    if(isRunning) await this.machine.moveSpindleAbsolute({z:3}, 1000, false);
                }
                if(isRunning) path.status = "done";
                if(isRunning) resolve();
                this.job.stopRunningPath = null;
            });
        },
        runJob: function(startFromBegining=false){
            if(this.job.stopRunningJob) return;
            if(startFromBegining || this.job.currentIndex >= this.job.contours.length) this.job.currentIndex = 0;
            return new Promise((resolve, reject)=>{
                this.job.stopRunningJob = reject;
                this.runPath(this.job.currentIndex, false).then(async ()=>{
                    this.job.currentIndex += 1;
                    if(this.job.currentIndex < this.job.contours.length) {
                        // Run next path
                        this.job.stopRunningJob = null;
                        await this.runJob(false).then(resolve, reject);
                    }
                    else {
                        // Stop spindle and home
                        await this.machine.moveSpindleAbsolute({z:3}, 1000, false);
                        await this.machine.stopSpindle();
                        await this.machine.moveSpindleAbsolute({x:0, y:0}, 1000, false);
                        this.job.stopRunningJob = null;
                        resolve();
                    }
                }).catch(async ()=>{
                    await this.machine.abortMove();
                    await this.machine.stopSpindle();
                    await this.machine.moveSpindleAbsolute({z:3}, 1000, false);
                    this.job.stopRunningJob = null;
                    reject();
                });
            });
        },
        isJobPathRunning: function(){
            return this.job.stopRunningJob != null || this.job.stopRunningPath != null;
        },
        pauseJob: function(){
            if(this.job.stopRunningPath) this.job.stopRunningPath();
            this.job.stopRunningPath = null;
            if(this.job.stopRunningJob) this.job.stopRunningJob();
            this.job.stopRunningJob = null;
        }

    }
})
//app.serial.readHandler = app.onSerialRead;
//app.machine = new Machine_CNC3018()
//app.machine.init();
window.app = app;
