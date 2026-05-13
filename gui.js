
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

let gaRangeMap = {
	"gaVars" : {
		defaultValue : 4,
		rangeToModel : function(v){ return Math.round(v) },
		bubbleText : function(v){ return Math.round(v).toString() }
	},
	"gaUpper" : {
		defaultValue : 1,
		rangeToModel : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(2) }
	},
	"gaLower" : {
		defaultValue : 0,
		rangeToModel : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(2) }
	},
	"gaIterations" : {
		defaultValue : 100,
		rangeToModel : function(v){ return Math.round(v) },
		bubbleText : function(v){ return Math.round(v).toString() }
	},
	"gaMinCost" : {
		defaultValue : 0,
		rangeToModel : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(2) }
	},
	"gaPopulation" : {
		defaultValue : 20,
		rangeToModel : function(v){ return Math.round(v) },
		bubbleText : function(v){ return Math.round(v).toString() }
	},
	"gaMutation" : {
		defaultValue : 0.2,
		rangeToModel : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(2) }
	},
	"gaSelection" : {
		defaultValue : 0.5,
		rangeToModel : function(v){ return v },
		bubbleText : function(v){ return v.toFixed(2) }
	},
	"gaEvalSteps" : {
		defaultValue : 300,
		rangeToModel : function(v){ return Math.round(v) },
		bubbleText : function(v){ return Math.round(v).toString() }
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

function setGASliders(){

	for( let i = 0; i < Object.keys( gaRangeMap ).length; i++ ){

		const sliderID = Object.keys( gaRangeMap )[i]
		const map = gaRangeMap[sliderID]
		const slider = document.getElementById( sliderID )
		if( slider ){
			slider.value = map.defaultValue
		}

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

function getGAValue(sliderID){

	const slider = document.getElementById(sliderID)
	const map = gaRangeMap[sliderID]
	return map.rangeToModel(parseFloat(slider.value))
}

function selectedGAVariables(){

	const keys = typeof BOIDS_GA_PARAMETER_KEYS !== "undefined"
		? BOIDS_GA_PARAMETER_KEYS
		: ["cohesion", "alignment", "separation", "targetWeight", "avoidance", "randomWeight"]
	const n = getGAValue("gaVars")
	return keys.slice(0, n)
}

function gaSliderInput(){

	for( let i = 0; i < Object.keys( gaRangeMap ).length; i++ ){

		const sliderID = Object.keys( gaRangeMap )[i]
		const map = gaRangeMap[sliderID]
		const slider = document.getElementById( sliderID )
		if( !slider ) continue

		const sliderValue = parseFloat( slider.value )
		const bubble = slider.parentElement.querySelector('.bubble')
		if( bubble ){
			bubble.innerHTML = map.bubbleText(sliderValue)
		}

	}

	const variablesText = document.getElementById("gaVariablesText")
	if( variablesText ){
		variablesText.innerHTML = selectedGAVariables().join(", ")
	}
}

function getGAOptionsFromUI(){

	let lowerLimit = getGAValue("gaLower")
	let upperLimit = getGAValue("gaUpper")
	if( lowerLimit > upperLimit ){
		const tmp = lowerLimit
		lowerLimit = upperLimit
		upperLimit = tmp
	}

	return {
		variables : selectedGAVariables(),
		numberOfVariables : getGAValue("gaVars"),
		lowerLimit : lowerLimit,
		upperLimit : upperLimit,
		maximumIterations : getGAValue("gaIterations"),
		minimumCost : getGAValue("gaMinCost"),
		populationSize : getGAValue("gaPopulation"),
		mutationRate : getGAValue("gaMutation"),
		selectionRate : getGAValue("gaSelection"),
		evaluationSeeds : [12345],
		maxSteps : getGAValue("gaEvalSteps"),
		yieldEverySteps : 5
	}
}

function setGAProgress(percent, text){

	const area = document.getElementById("gaProgressArea")
	const bar = document.getElementById("gaProgressBar")
	const status = document.getElementById("gaStatusText")

	if( area ) area.style.display = "block"
	if( bar ) bar.style.width = Math.max(0, Math.min(100, percent)).toFixed(1) + "%"
	if( status ) status.innerHTML = text
}

function gaProgressPercent(progress, options){

	if( progress.phase !== "evaluating" ) return null

	const totalGenerations = options.maximumIterations + 1
	const seedCount = options.evaluationSeeds.length
	const perIndividual = seedCount * options.maxSteps
	const perGeneration = options.populationSize * perIndividual
	const completedGenerations = progress.generation * perGeneration
	const completedIndividuals = (progress.individual - 1) * perIndividual
	const completedSeeds = (progress.seedIndex - 1) * options.maxSteps
	const completedSteps = progress.step
	const total = totalGenerations * perGeneration

	return 100 * (completedGenerations + completedIndividuals + completedSeeds + completedSteps) / total
}

async function runGAFromUI(){

	if( typeof runAndApplyBoidsGAOptimizationAsync !== "function" ){
		throw new Error("GA optimizer is not loaded")
	}

	const button = document.getElementById("gaRun")
	const options = getGAOptionsFromUI()

	if( button ) button.disabled = true
	setGAProgress(0, "Starting GA optimization...")

	options.onProgress = function(progress){
		const percent = gaProgressPercent(progress, options)
		if( percent !== null ){
			setGAProgress(
				percent,
				"Generation " + progress.generation + "/" + options.maximumIterations +
				", individual " + progress.individual + "/" + options.populationSize +
				", seed " + progress.seedIndex + "/" + options.evaluationSeeds.length +
				", step " + progress.step + "/" + options.maxSteps
			)
		}

		if( progress.phase === "generation" ){
			setGAProgress(
				100 * progress.generation / options.maximumIterations,
				"Generation " + progress.generation + "/" + options.maximumIterations +
				" complete. Best fitness: " + progress.bestFitness.toFixed(4) +
				", cost: " + progress.bestCost.toFixed(4)
			)
		}
	}

	try {
		const result = await runAndApplyBoidsGAOptimizationAsync(options)
		window.lastGAResult = result
		setGAProgress(
			100,
			"GA complete. Applied best weights. Fitness: " +
			result.fitness.toFixed(4) + ", cost: " + result.cost.toFixed(4)
		)
		console.log(result)
	} catch(err) {
		console.error(err)
		setGAProgress(0, "GA failed: " + err.message)
	} finally {
		if( button ) button.disabled = false
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
