(const_item
  name: (identifier) @name) @definition.constant

(struct_item
  name: (type_identifier) @name) @definition.class

(enum_item
  name: (type_identifier) @name) @definition.class

(trait_item
  name: (type_identifier) @name) @definition.interface

(type_item
  name: (type_identifier) @name) @definition.type

(function_item
  name: (identifier) @name) @definition.function

(call_expression
  function: (identifier) @name) @reference.call

(type_identifier) @reference.type
