(function_definition
  name: (word) @name) @definition.function

(variable_assignment
  name: (variable_name) @name) @definition.constant

(command
  name: (command_name
    (word) @name)) @reference.call
