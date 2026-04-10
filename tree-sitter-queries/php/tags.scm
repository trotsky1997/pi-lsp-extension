(class_declaration
  name: (name) @name) @definition.class

(method_declaration
  name: (name) @name) @definition.method

(function_definition
  name: (name) @name) @definition.function

(const_element
  (name) @name) @definition.constant

(function_call_expression
  function: (name) @name) @reference.call
