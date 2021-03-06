var SpeechRecognition = SpeechRecognition || window["webkitSpeechRecognition"];
var SpeechGrammarList = SpeechGrammarList || window["webkitSpeechGrammarList"];
var SpeechRecognitionEvent =
  SpeechRecognitionEvent || window["webkitSpeechRecognitionEvent"];

var colors = {
  red: 1,
  green: 1,
  blue: 1
};

var game = {
  timeStarted: null,
  plots: [],
  money: 0,
  inventory: {}
};

var plantUtil = {
  getPlant: p => {
    let plant = plants[p];
    // try plural
    if (!plant) {
      const _p = Object.keys(plants).find(k => {
        const _plant = plants[k];
        if (_plant.pl.toLowerCase() === p) {
          return true;
        }
      });
      if (_p) {
        plant = plants[_p];
      }
    }

    return plant;
  }
};

var invUtil = {
  give: (thing, amt) => {
    if (!game.inventory[thing]) {
      game.inventory[thing] = 0;
    }

    game.inventory[thing] += amt;
  },
  pay: (thing, amt) => {
    if (!game.inventory[thing] || game.inventory[thing] < amt) {
      return false;
    } else {
      game.inventory[thing] -= amt;
      return true;
    }
  },
  listSeeds: () => {
    const ret = {};
    Object.keys(game.inventory).forEach(k => {
      if (game.inventory[k] > 0 && k.includes("_seed")) {
        ret[k] = game.inventory[k];
      }
    });
    return ret;
  },
  listPlants: () => {
    const ret = {};
    Object.keys(game.inventory).forEach(k => {
      if (game.inventory[k] > 0 && plants[k]) {
        ret[k] = game.inventory[k];
      }
    });
    return ret;
  }
};

var plotUtil = {
  addPlot: () => {
    game.plots.push({
      planted: null,
      timePlanted: null,
      ready: false,
      sprinkler: false,
      fertilizer: false
    });
  },
  available: () => {
    return game.plots.filter(p => {
      return p.planted === null;
    });
  },
  currentlyPlanted: () => {
    const plants = {};
    game.plots.forEach(p => {
      if (p.planted && !plants[p.planted]) {
        plants[p.planted] = 1;
      }
    });
    return Object.keys(plants);
  },
  plant: p => {
    const plant = plantUtil.getPlant(p);
    const available = plotUtil.available();
    if (!plant) {
      ai.speak(
        `Sorry, I'm not sure what ${p} is, please plant something *real*`
      );
      return;
    }
    if (available.length > 0) {
      const plot = available[0];
      if (invUtil.pay(`${plant.id}_seed`, 1)) {
        plot.planted = plant.id;
        plot.timePlanted = Date.now();
        ai.speak(
          `${plant.pl} planted, they will be ready in ${plant.time} minutes`
        );
        return true;
      } else {
        ai.speak(`Sorry, you don't have any ${plant.name} seeds`);
      }
    } else {
      ai.speak(`Sorry, you don't have any free plots`);
    }
  },
  timeLeft: plot => {
    if (plot.timePlanted && plot.planted) {
      const matureTime = plotUtil.timeToMature(plot);
      const delta = matureTime - Date.now();
      return delta;
    }
  },
  timeToMature: plot => {
    if (plot.timePlanted && plot.planted) {
      const plant = plantUtil.getPlant(plot.planted);
      const matureTime = plot.timePlanted + plant.time * 1000 * 60;
      return matureTime;
    }
    return 0;
  },
  harvest: plot => {
    if (!plot) {
      // harvest anything available
      game.plots.forEach(p => {
        if (p.timePlanted && p.planted) {
          plotUtil.harvest(p);
        }
      });
    } else {
      if (plotUtil.timeLeft(plot) <= 0) {
        let amt = 10; // base

        invUtil.give(plot.planted, amt);

        const hvt = {};
        hvt[plot.planted] = amt;
        plot.ready = false;
        plot.planted = null;
        plot.timePlanted = null;

        return hvt;
      }
      return null;
    }
  },
  reportSeeds: () => {
    const seeds = Object.keys(game.inventory)
      .filter(s => {
        return s.includes("_seed") && game.inventory[s] > 0;
      })
      .map(s => {
        return {
          plant: s.split("_seed")[0],
          amt: game.inventory[s]
        };
      });
    return seeds;
  },
  process: () => {
    const matured = {};
    game.plots.forEach(p => {
      if (p.planted && p.timePlanted && !p.ready) {
        if (plotUtil.timeLeft(p) <= 0) {
          p.ready = true;
          matured[p.planted] = true;
        }
      }
    });

    if (Object.keys(matured).length > 0) {
      const arr = Object.keys(matured).map(p => {
        return plantUtil.getPlant(p).pl;
      });

      ai.speak(`The ` + toList(arr) + ` are ready for harvesting!`);
    }

    setTimeout(() => {
      plotUtil.process();
    }, 100);
  }
};

var cheatcode = "up up down down left right left right b a".split(" ");
var cheatstate = 0;
var keycodes = {
  up: 38,
  down: 40,
  left: 37,
  right: 39,
  b: 66,
  a: 65
};
function cost(color) {
  var amt = Math.round(5 * Math.pow(1.12, colors[color]));

  return amt;
}

var needUpdate = {
  bg: true,
  inkLevels: true
};

var entities = ['seed', 'produce', 'plant', 'plot', 'sprinkler', 'fertilizer', 'morgan', 'sell', 'buy', 'multiple'];


var grammar =
  "#JSGF V1.0; grammar codewords; public <codewords> = " +
  [
    ...Object.keys(colors),
    ...Object.keys(commands),
    ...Object.keys(bigCommands),
    ...entities,
    ...entities.map(e => `${e}s`)
  ].join(" | ") +
  " ;";

var diagnostic = document.querySelector(".output");
var bg = document.querySelector("html");
var hints = document.querySelector(".hints");
var inkLevels = document.getElementById("inkLevels");
var bubble = document.getElementById("speech-bubble");
var prestigeText = document.getElementById("prestige-text");

var ink = {
  red: 0,
  green: 0,
  blue: 0
};
var opacity = 1;
var canPrestige = false;
var maxInk = 2550;

/*******Speech Recognition*********/
if (SpeechRecognition) {
  var recognition = new SpeechRecognition();
  var speechRecognitionList = new SpeechGrammarList();
  speechRecognitionList.addFromString(grammar, 1);
  recognition.grammars = speechRecognitionList;
  recognition.continuous = true;
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = event => {
    var last = event.results.length - 1;
    var text = event.results[last][0].transcript;

    diagnostic.textContent = "Command: " + text;
    console.log("Confidence: " + event.results[0][0].confidence);
    process(text);
  };

  recognition.onspeechend = function() {
    setTimeout(() => {
      listen();
    }, 1000);
    diagnostic.textContent = "...";
  };

  recognition.onnomatch = function(event) {
    diagnostic.textContent = "Unrecognized text";
    setTimeout(() => {
      listen();
    }, 1000);
  };

  recognition.onerror = function(event) {
    if (event.error !== "not-allowed") {
      setTimeout(() => {
        listen();
      }, 1000);
    } else {
      diagnostic.textContent = "Error occurred in recognition: " + event.error;
    }
  };
} else {
  diagnostic.textContent =
    "Speech Recognition not detected. You will have to use Google Chrome on Desktop or Android, and you will have to allow the page to use your microphone.";

  document.getElementById("testing").style.display = "block";
}

/*******Speech Synthesis***********/

var synth = window.speechSynthesis;

document.addEventListener("keydown", event => {
  console.log(event.keyCode);
  const expectedCode = keycodes[cheatcode[cheatstate]];
  if (expectedCode && event.keyCode && expectedCode === event.keyCode) {
    cheatstate++;
    if (cheatstate === cheatcode.length) {
      enableCheat();
    }
  } else {
    cheatstate = 0;
  }
});

/****Init/Config************/

// test
Object.keys(colors).forEach(c => {
  document.getElementById(c).addEventListener("click", () => {
    process(`add ${c}`);
  });

  document.getElementById(`upgrade-${c}`).addEventListener("click", () => {
    process(`upgrade ${c}`);
  });
});

document.getElementById("prestige").addEventListener("click", () => {
  process(`prestige`);
});

document.getElementById("status").addEventListener("click", () => {
  process("status");
});

// title screen
var titleScreen = document.getElementById("title-screen");
var startButton = document.getElementById("start");
if (localStorage.getItem("save")) {
  startButton.textContent = "Continue";
}

startButton.addEventListener("click", () => {
  start();
});

/****State checking*********/

function canAffordPrestige() {
  return (
    opacity <= 10 &&
    Object.keys(ink).every(c => {
      return ink[c] >= 2550;
    })
  );
}

/****Helpful utils */

function toList(arr) {
  if (arr.length === 0) {
    return "";
  } else if (arr.length === 1) {
    return arr[0];
  } else {
    const last = arr.pop();
    return arr.join(", ") + " and " + last;
  }
}

function itemize(things) {
  return Object.keys(things).map(k => {
    if (k.includes("_seed")) {
      // it's a seed
      const p = k.split("_seed")[0];
      return `${things[k]} ${p} seed${things[k] === 1 ? "" : "s"}`;
    } else if (plants[k]) {
      return `${things[k]} ${things[k] === 1 ? plants[k].name : plants[k].pl}`;
    }
  });
}

/****Interacting************/

function incrementInk(color) {
  ink[color] += colors[color];
  needUpdate.bg = true;
  needUpdate.ink = true;

  if (
    Object.keys(ink).every(k => {
      return ink[k] >= maxInk;
    })
  ) {
    speak("Well done, you got pure white. The End.");
  }
}

function buyUpgrade(color) {
  if (ink[color] >= cost(color)) {
    ink[color] -= cost(color);
    colors[color]++;
    needUpdate.bg = true;
    needUpdate.ink = true;
  }
}

function prestige() {
  if (canPrestige) {
    Object.keys(ink).forEach(c => {
      ink[c] -= maxInk;
    });
    opacity += 1;

    maxInk = Math.round(2550, Math.pow(1.15, opacity - 1));
    needUpdate.bg = true;
    needUpdate.ink = true;

    canPrestige = false;
  }
}

/****Rendering**********/

function updateBg() {
  bg.style.backgroundColor = `rgba(${Math.min(
    (ink.red / maxInk) * 255,
    255
  )}, ${Math.min((ink.green / maxInk) * 255, 255)}, ${Math.min(
    (ink.blue / maxInk) * 255,
    255
  )}, ${opacity / 10})`;
}

function updateInkLevels() {
  inkLevels.innerHTML = Object.keys(ink).reduce((str, k) => {
    return (
      str +
      `<div ${
        ink[k] >= cost(k) ? 'class="upgrade"' : ""
      }><span class="name">${k}</span> <span class="level">${
        ink[k]
      }/${maxInk}</span> Adds ${colors[k]} each time, Upgrade Cost: ${cost(
        k
      )}</div>`
    );
  }, "");

  if (canAffordPrestige()) {
    canPrestige = true;
  }

  prestigeText.innerHTML = `Prestige: ${opacity - 1} / 10. ${
    canPrestige ? "You can prestige" : ""
  }`;
}

function update() {
  if (needUpdate.bg) {
    updateBg();
  }
  if (needUpdate.inkLevels) {
    updateInkLevels();
  }

  setTimeout(update, 0.5);
}

const ai = {
  currentPrompt: null,
  promptReminder: null,
  numReminders: 0,
  speechQueue: [],
  interruptSpeaking: () => {
    if (synth.speaking) {
      synth.cancel();
      setTimeout(() => {
        speak(`Okie dokie, I'll be quiet now`);
      }, 100);
    } else {
      speak(`But I wasn't saying anything!`);
    }
  },
  speak: text => {
    if (synth.speaking) {
      ai.speechQueue.push(text);
    } else {
      if (text !== "") {
        var utterThis = new SpeechSynthesisUtterance(text);

        utterThis.onend = function(event) {
          console.log("SpeechSynthesisUtterance.onend");
        };
        utterThis.onerror = function(event) {
          console.error("SpeechSynthesisUtterance.onerror");
        };

        synth.speak(utterThis);
        bubble.textContent = text;
      } else {
        if (onFinish) {
          onFinish();
        }
      }
    }
  },
  prompt: text => {
    ai.currentPrompt = text;
    if (synth.speaking) {
      synth.cancel();
      setTimeout(() => {
        ai.prompt(text);
      }, 100);
    } else {
      ai.speak(text);
      ai.promptReminder =
        Date.now() + Math.round(10 * 1000 * Math.pow(1.25, ai.numReminders));
    }
  },
  answerPrompt: text => {},
  remindPrompt: () => {
    if (ai.currentPrompt) {
      ai.speak(
        `I haven't heard your answer in a while so let me ask again. ${
          ai.currentPrompt
        }`
      );
    }
  },
  process: () => {
    if (!synth.speaking) {
      if (ai.currentPrompt && ai.promptReminder < Date.now()) {
        ai.remindPrompt();
      } else {
        if (ai.speechQueue.length > 0) {
          const text = ai.speechQueue.shift();
          ai.speak(text);
        }
      }
    }
    setTimeout(() => {
      ai.process();
    }, 100);
  }
};

function listen() {
  if (recognition) {
    recognition.start();
    diagnostic.textContent = "listening";
  }
}

function enableCheat() {
  speak("Cheat enabled");
  document.getElementById("testing").style.display = "block";
}

function toggleBlindMode(on) {
  if (on) {
    speak("blind mode is now on");
    document.getElementById("inkWell").style.display = "none";
  } else {
    speak("blind mode is off");
    document.getElementById("inkWell").style.display = "none";
  }
}

function explainHelp() {
  const text = document.getElementById("commands").textContent;
  console.log(text);
  speak(text);
}

function checkBigCommands(text) {
  // cheatcode
  if (text === cheatcode.join(" ")) {
    enableCheat();
    return true;
  } else if (bigCommands[text]) {
    bigCommands[text]();
    return true;
  }

  return false;
}

function process(text) {
  text = text.toLowerCase();
  if (checkBigCommands(text)) {
    return;
  }

  const parts = text.split(" ");
  let i = 0;
  let command;
  let parameters = [];
  while (i <= parts.length) {
    const cur = parts[i];

    if (!command && commands[cur]) {
      command = commands[cur];
    } else {
      if (command) {
        // must be a parameter
        parameters.push(cur);
      } else {
        // not a command, there is no command recognized, must be rubbish
      }
    }

    if (command && parameters.length === command.parameters.length) {
      command.fn.apply(this, parameters);
      command = null;
      parameters = [];
    }

    i++;
  }
}

function start() {
  titleScreen.style.display = "none";
  // check localstorage
  if (localStorage.getItem("save")) {
    game = JSON.parse(localStorage.getItem("save"));
  } else {
    // ai.speak("Howdy! Welcome to Call of Farming!");
    // ai.speak(
    //   "You are stranded in a weird magical land with a dilapidated house and an indestructible magical vending machine called Morgan. I am Morgan."
    // );
    // ai.speak(
    //   `To help you along, I have given you a pack of potato seeds and a single plot of land. To plant the seeds, say "plant potatoes"`
    // );
    invUtil.give("potato_seed", 1);
    plotUtil.addPlot();
  }

  ai.process();
  plotUtil.process();
}

function save() {
  localStorage.setItem("save", JSON.stringify(game));
}
listen();
update();
