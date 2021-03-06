import Ember from 'ember';
import FactoryGuy from './factory-guy';
import Sequence from './sequence';
import MissingSequenceError from './missing-sequence-error';
import $ from 'jquery';

/**
 A ModelDefinition encapsulates a model's definition

 @param model
 @param config
 @constructor
 */
var ModelDefinition = function (model, config) {
  var sequences = {};
  var traits = {};
  var transient = {};
  var afterMake = null;
  var defaultAttributes = {};
  var namedModels = {};
  var modelId = 1;
  var sequenceName = null;
  var modelName = this.modelName = model;

  /**
   Returns a model's full relationship if the field is a relationship.

   @param {String} field  field you want to relationship info for
   @returns {DS.Relationship} relationship object if the field is a relationship, null if not
   */
  var getRelationship = function (field) {
    var modelClass = FactoryGuy.getStore().modelFor(modelName);
    var relationship = Ember.get(modelClass, 'relationshipsByName').get(field);
    return !!relationship ? relationship : null;
  };
  /**
   @param {String} name model name like 'user' or named type like 'admin'
   @returns {Boolean} true if name is this definitions model or this definition
   contains a named model with that name
   */
  this.matchesName = function (name) {
    return modelName === name || namedModels[name];
  };
  // Increment id
  this.nextId = function () {
    return modelId++;
  };
  /**
   Call the next method on the named sequence function. If the name
   is a function, create the sequence with that function

   @param   {String} name previously declared sequence name or
   an the random name generate for inline functions
   @param   {Function} sequenceFn optional function to use as sequence
   @returns {String} output of sequence function
   */
  this.generate = function (name, sequenceFn) {
    if (sequenceFn) {
      if (!sequences[name]) {
        // create and add that sequence function on the fly
        sequences[name] = new Sequence(sequenceFn);
      }
    }
    var sequence = sequences[name];
    if (!sequence) {
      throw new MissingSequenceError('Can not find that sequence named [' + sequenceName + '] in \'' + model + '\' definition');
    }
    return sequence.next();
  };
  /**
   Build a fixture by name

   @param {String} name fixture name
   @param {Object} opts attributes to override
   @param {String} traitArgs array of traits
   @returns {Object} json
   */
  this.build = function (name, opts, traitArgs) {
    var traitsObj = {};
    traitArgs.forEach(function (trait) {
      $.extend(traitsObj, traits[trait]);
    });
    var modelAttributes = namedModels[name] || {};
    // merge default, modelAttributes, traits and opts to get the rough fixture
    var fixture = $.extend({}, defaultAttributes, modelAttributes, traitsObj, opts);
    // deal with attributes that are functions or objects
    for (var attribute in fixture) {
      if (Ember.typeOf(fixture[attribute]) === 'function') {
        // function might be a sequence, an inline attribute function or an association
        fixture[attribute] = fixture[attribute].call(this, fixture);
      } else if (Ember.typeOf(fixture[attribute]) === 'object') {
        // If it's an object and it's a model association attribute, build the json
        // for the association and replace the attribute with that json
        var relationship = getRelationship(attribute);
        if (relationship) {
          fixture[attribute] = FactoryGuy.buildRaw(relationship.type, fixture[attribute]);
        }
      }
    }
    // set the id, unless it was already set in opts
    if (!fixture.id) {
      fixture.id = this.nextId();
    }
    return fixture;
  };
  /**
   Build a list of fixtures

   @param {String} name model name or named model type
   @param {Integer} number of fixtures to build
   @param {Array} array of traits to build with
   @param {Object} opts attribute options
   @returns array of fixtures
   */
  this.buildList = function (name, number, traits, opts) {
    var arr = [];
    for (var i = 0; i < number; i++) {
      arr.push(this.build(name, opts, traits));
    }
    return arr;
  };
  // Set the modelId back to 1, and reset the sequences
  this.reset = function () {
    modelId = 1;
    for (var name in sequences) {
      sequences[name].reset();
    }
  };

  this.hasAfterMake = function () {
    return !!afterMake;
  };

  this.applyAfterMake = function (model, opts) {
    if (afterMake) {
      // passed in options override transient setting
      var options = $.extend({}, transient, opts);
      afterMake(model, options);
    }
  };
  /*
   Need special 'merge' function to be able to merge objects with functions

   @param newConfig
   @param config
   @param otherConfig
   @param section
   */
  var mergeSection = function (config, otherConfig, section) {
    var attr;
    if (otherConfig[section]) {
      if (!config[section]) {
        config[section] = {};
      }
      for (attr in otherConfig[section]) {
        if (!config[section][attr]) {
          config[section][attr] = otherConfig[section][attr];
        }
      }
    }
  };
  /**
   When extending another definition, merge it with this one by:
   merging only sequences, default section and traits

   @param {Object} config
   @param {ModelDefinition} otherDefinition
   */
  var merge = function (config, otherDefinition) {
    var otherConfig = $.extend(true, {}, otherDefinition.originalConfig);
    delete otherConfig.extends;
    mergeSection(config, otherConfig, 'sequences');
    mergeSection(config, otherConfig, 'default');
    mergeSection(config, otherConfig, 'traits');
  };

  var mergeConfig = function (config) {
    var extending = config.extends;
    var definition = FactoryGuy.findModelDefinition(extending);
    Ember.assert(
      "You are trying to extend [" + model + "] with [ " + extending + " ]." +
      " But FactoryGuy can't find that definition [ " + extending + " ] " +
      "you are trying to extend. Make sure it was created/imported before " +
      "you define [" + model + "]", definition);
    merge(config, definition);
  };

  var parseDefault = function (config) {
    defaultAttributes = config.default;
    delete config.default;
  };

  var parseTraits = function (config) {
    traits = config.traits;
    delete config.traits;
  };

  var parseTransient = function (config) {
    transient = config.transient;
    delete config.transient;
  };

  var parseCallBacks = function (config) {
    afterMake = config.afterMake;
    delete config.afterMake;
  };

  var parseSequences = function (config) {
    sequences = config.sequences || {};
    delete config.sequences;
    for (sequenceName in sequences) {
      var sequenceFn = sequences[sequenceName];
      if (Ember.typeOf(sequenceFn) !== 'function') {
        throw new Error(
          'Problem with [' + sequenceName + '] sequence definition. ' +
          'Sequences must be functions');
      }
      sequences[sequenceName] = new Sequence(sequenceFn);
    }
  };

  var parseConfig = function (config) {
    if (config.extends) {
      mergeConfig.call(this, config);
    }
    parseSequences(config);
    parseTraits(config);
    parseDefault(config);
    parseTransient(config);
    parseCallBacks(config);
    namedModels = config;
  };
  // During parseConfig, the original config will be altered, so save this original
  // configuration since it's needed for merging when others extend this definition.
  this.originalConfig = $.extend(true, {}, config);
  // initialize
  parseConfig.call(this, config);
};

export default ModelDefinition;

