
// linking configuration parameters to the slider's ID in the html;
// used in ./gui.js to set sliders and update model parameters if sliders change

let rangeMap = {
	"wa" : {
		key : 'alignment',
		rangeToModel : function(v){ return v/100 },
		modelToRange : function(v){ return v*100 }
	},
	"wc" : {
		key : 'cohesion',
		rangeToModel : function(v){ return v/100 },
		modelToRange : function(v){ return v*100 }
	},
	"ws" : {
		key : 'separation',
		rangeToModel : function(v){ return v/100 },
		modelToRange : function(v){ return v*100 }
	},
	"Ro" : {
		key : 'outerRadius',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v }
	},
	"Ri" : {
		key : 'innerRadius',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v }
	}
}


function setSliders(){

	for( let i = 0; i < Object.keys( rangeMap ).length; i++ ){
		
		const sliderID = Object.keys( rangeMap )[i]
		const confID = rangeMap[sliderID]

		let value
		let conf = S.conf
		value = confID.modelToRange( conf[confID.key] )
		
		document.getElementById( sliderID ).value = value

	}
}

function sliderInput(){
	
	for( let i = 0; i < Object.keys( rangeMap ).length; i++ ){
		
		const sliderID = Object.keys( rangeMap )[i]
		const map = rangeMap[sliderID]
		
		const sliderValue = parseFloat( document.getElementById( sliderID ).value )
		const modelValue = map.rangeToModel( sliderValue )
		
		// update logger next to slider
		const bubble = document.getElementById( sliderID ).parentElement.querySelector('.bubble')
		let bubbleText = map.rangeToModel(parseFloat( document.getElementById( sliderID ).value ))
		if( map.hasOwnProperty("bubbleText")) bubbleText = map.bubbleText(parseFloat( document.getElementById( sliderID ).value ))
		bubble.innerHTML = bubbleText
		
		// update model parameters.
		let conf = S.conf	
		conf[map.key] = modelValue
		
				
	}
		
}

	function initCanvas(){

		const canvasID = "canvasModel"
		document.getElementById(canvasID).innerHTML = ""
		sim.helpClasses["canvas"] = true
		sim.Cim = new CPM.Canvas( sim.C, {zoom:config.simsettings.zoom, parentElement: document.getElementById(canvasID) } )	
		document.getElementById("time").innerHTML = 0
	}


function resetSim(){
	
	running = false
	S.reset()
	sliderInput()
	setPlayPause()
}


function setPlayPause(){
	if( running ){
		$('#playIcon').removeClass('fa-play');$('#playIcon').addClass('fa-pause')
	} else {
		$('#playIcon').removeClass('fa-pause');$('#playIcon').addClass('fa-play')
	}	
}


