
let rangeMap = {
	"wa" : {
		key : 'alignment',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(3) }
	},
	"wc" : {
		key : 'cohesion',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(3) }
	},
	"ws" : {
		key : 'separation',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(3) }
	},
	"wt" : {
		key : 'targetWeight',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(3) }
	},
	"wo" : {
		key : 'avoidance',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(3) }
	},
	"wr" : {
		key : 'randomWeight',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(3) }
	},
	"rSep" : {
		key : 'separationRadius',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(0) }
	},
	"rInt" : {
		key : 'interactionRadius',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(0) }
	},
	"rObs" : {
		key : 'obstaclePerceptionRadius',
		rangeToModel : function(v){ return v },
		modelToRange : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(0) }
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

		const bubble = document.getElementById( sliderID ).parentElement.querySelector('.bubble')
		let bubbleText = map.rangeToModel(parseFloat( document.getElementById( sliderID ).value ))
		if( map.hasOwnProperty("bubbleText")) bubbleText = map.bubbleText(parseFloat( document.getElementById( sliderID ).value ))
		bubble.innerHTML = bubbleText

		let conf = S.conf
		conf[map.key] = modelValue


	}
}


function resetSim(){

	running = false
	S.reset()
	sliderInput()
	document.getElementById("time").innerHTML = S.time
	updateMetrics()
	canvas.drawSwarm()
	setPlayPause()
}

function applyWeightsToSimulation(weights, options = {}){

	if( !weights ){
		throw new Error("No weights were provided")
	}

	const shouldReset = options.reset !== false
	const appliedWeights = {}

	for( const key of Object.keys(weights) ){
		if( Object.prototype.hasOwnProperty.call(S.conf, key) ){
			appliedWeights[key] = weights[key]
		}
	}

	Object.assign(S.conf, appliedWeights)
	Object.assign(conf, appliedWeights)
	setSliders()

	if( shouldReset ){
		running = false
		S.reset()
	}

	document.getElementById("time").innerHTML = S.time
	updateMetrics()
	canvas.drawSwarm()
	setPlayPause()

	return appliedWeights
}

function newTarget(){

	S.generateNewTarget()
	updateMetrics()
	canvas.drawSwarm()
}


function setPlayPause(){
	if( running ){
		$('#playIcon').removeClass('fa-play');$('#playIcon').addClass('fa-pause')
	} else {
		$('#playIcon').removeClass('fa-pause');$('#playIcon').addClass('fa-play')
	}
}
