// Random-action agent: returns one of four directions per turn.
//
//   TORNASOL_API_KEY=k_... tornasol-run-agent --agent ./random-agent.js

'use strict';

const DIRECTIONS = ['up', 'down', 'left', 'right'];

function chooseAction(_observation) {
  return { direction: DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)] };
}

module.exports = { chooseAction };
